/**
 * Unified Day Allocation Core (Schritt 2).
 *
 * Deterministisch: UnifiedDayPlannerInput → UnifiedDayPlan.
 * Keine KI, keine Live-Writes, keine Takeover.
 * Bestehende DailyPlan-allocation.ts bleibt Produktions-Pfad; dieser Core ist die
 * gemeinsame One-Plan-Bilanzschicht gegen Golden/ALLOC-Tests.
 */

import { operatorQuality } from "../../quality";
import type {
	UnifiedAllocationCell,
	UnifiedBatteryTrajectoryPoint,
	UnifiedConstraint,
	UnifiedDayPlan,
	UnifiedDayPlannerInput,
	UnifiedFlexConsumerKind,
	UnifiedGoalStatus,
} from "./types";
import { deriveUnifiedHardConstraints } from "./types";
import { REASON } from "./reason_codes";

const SLOT_H = 0.25;
const EPS = 1e-6;

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function inWindow(iso: string, startIso: string, endIso: string): boolean {
	const t = Date.parse(iso);
	return t >= Date.parse(startIso) && t < Date.parse(endIso);
}

function vehiclePresent(input: UnifiedDayPlannerInput, slotStartIso: string): boolean {
	const wb = input.wallbox;
	if (!wb) return false;
	if (!wb.presenceHardConstraint) {
		return wb.connectedNow;
	}
	for (const w of wb.presenceWindows) {
		if (w.available && inWindow(slotStartIso, w.startIso, w.endIso)) return true;
	}
	return false;
}

function energyFromPowerW(powerW: number): number {
	return (powerW / 1000) * SLOT_H;
}

function powerFromEnergyKwh(kwh: number): number {
	return (kwh / SLOT_H) * 1000;
}

function pvConfidenceFactor(input: UnifiedDayPlannerInput): number {
	const c = input.pv.uncertainty.confidencePct;
	if (c === null || !Number.isFinite(c)) return 1;
	return Math.max(0.2, Math.min(1, c / 100));
}

type SlotWork = {
	startIso: string;
	endIso: string;
	pvKwh: number;
	houseKwh: number;
	/** PV nach Hauslast. */
	surplusKwh: number;
	importCt: number | null;
	exportCt: number | null;
	gridAllowed: boolean;
	/** Noch verfügbarer PV-Surplus nach Flex-Allocation. */
	remainPvKwh: number;
};

function buildSlots(input: UnifiedDayPlannerInput): SlotWork[] {
	const byStart = new Map<string, SlotWork>();
	for (const s of input.time.slots) {
		byStart.set(s.startIso, {
			startIso: s.startIso,
			endIso: s.endIso,
			pvKwh: 0,
			houseKwh: 0,
			surplusKwh: 0,
			importCt: null,
			exportCt: null,
			gridAllowed: true,
			remainPvKwh: 0,
		});
	}
	for (const p of input.pv.slots) {
		const w = byStart.get(p.slot.startIso);
		if (!w) continue;
		// null ≠ 0: fehlende Prognose bleibt 0-Energie im Slot, aber ohne Fake-Leistung
		if (p.energyKwh !== null && p.energyKwh !== undefined) w.pvKwh = p.energyKwh;
		else if (p.forecastPowerW !== null && p.forecastPowerW !== undefined) {
			w.pvKwh = energyFromPowerW(p.forecastPowerW);
		}
	}
	for (const h of input.houseLoad.slots) {
		const w = byStart.get(h.slot.startIso);
		if (!w) continue;
		if (h.energyKwh !== null && h.energyKwh !== undefined) w.houseKwh = h.energyKwh;
		else if (h.forecastPowerW !== null && h.forecastPowerW !== undefined) {
			w.houseKwh = energyFromPowerW(h.forecastPowerW);
		}
	}
	for (const pr of input.prices.slots) {
		const w = byStart.get(pr.slot.startIso);
		if (!w) continue;
		w.importCt = pr.importCtPerKwh;
		w.exportCt = pr.exportCtPerKwh;
		w.gridAllowed = pr.gridImportAllowed;
	}
	const slots = [...byStart.values()].sort((a, b) => a.startIso.localeCompare(b.startIso));
	for (const w of slots) {
		w.surplusKwh = Math.max(0, w.pvKwh - w.houseKwh);
		w.remainPvKwh = w.surplusKwh;
	}
	return slots;
}

function pushAlloc(
	out: UnifiedAllocationCell[],
	slot: SlotWork,
	consumerId: string,
	kind: UnifiedFlexConsumerKind,
	energyKwh: number,
	source: UnifiedAllocationCell["energySource"],
	constraintIds: string[],
	reasonCodes: string[],
	maxPowerW: number | null,
): void {
	if (energyKwh <= EPS) return;
	let e = energyKwh;
	if (maxPowerW !== null && maxPowerW > 0) {
		e = Math.min(e, energyFromPowerW(maxPowerW));
	}
	if (e <= EPS) return;
	out.push({
		slot: { startIso: slot.startIso, endIso: slot.endIso },
		consumerId,
		kind,
		allocatedPowerW: round3(powerFromEnergyKwh(e)),
		allocatedEnergyKwh: round3(e),
		energySource: source,
		constraintIds,
		reasonCodes,
	});
}

function takePv(slot: SlotWork, wantKwh: number): number {
	const take = Math.min(slot.remainPvKwh, wantKwh);
	slot.remainPvKwh = Math.max(0, slot.remainPvKwh - take);
	return take;
}

/**
 * Phase B: Fahrzeug rückwärts / PV-first vor Deadline, sonst günstige Import-Slots.
 */
function allocateVehicle(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	allocations: UnifiedAllocationCell[],
	goals: UnifiedGoalStatus[],
): void {
	const wb = input.wallbox;
	if (!wb) return;
	const lossFactor = wb.chargeLossFactor ?? 1;
	let needKwh: number | null = wb.requiredEnergyKwh;
	if (needKwh === null || needKwh <= 0) {
		if (wb.targetSocPct !== null && wb.vehicleSocPct !== null && wb.vehicleCapacityKwh !== null) {
			needKwh = (Math.max(0, wb.targetSocPct - wb.vehicleSocPct) / 100) * wb.vehicleCapacityKwh;
		} else {
			needKwh = wb.fallbackEnergyNeedKwh;
		}
	}
	if (needKwh === null || needKwh <= EPS) {
		goals.push({
			consumerId: "wallbox",
			goalId: "energy",
			met: true,
			detailDe: "Kein Fahrzeug-Energiebedarf.",
		});
		return;
	}
	let remaining = needKwh * lossFactor;

	const deadlineMs = wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY;
	const useSlots = slots.filter(
		(s) => Date.parse(s.startIso) < deadlineMs && vehiclePresent(input, s.startIso),
	);

	const conf = pvConfidenceFactor(input);
	const maxW = wb.maxChargePowerW;
	const minW = wb.minChargePowerW;

	// Sichere PV vor Deadline: nur confidence-Anteil als „sicher“ für harte Ziele zählen
	const safePvBudget = useSlots.reduce((a, s) => a + s.remainPvKwh, 0) * conf;
	let pvAllocated = 0;

	for (const s of useSlots) {
		if (remaining <= EPS) break;
		if (pvAllocated >= safePvBudget && wb.energyGoalHard && conf < 0.95) {
			// Rest eher über Import — aber restlichen Slot-PV trotzdem nutzen wenn noch da
		}
		let take = Math.min(s.remainPvKwh, remaining);
		if (minW && take > 0 && take < energyFromPowerW(minW)) {
			if (s.remainPvKwh >= energyFromPowerW(minW)) take = energyFromPowerW(minW);
			else continue;
		}
		take = takePv(s, take);
		if (take <= EPS) continue;
		pushAlloc(
			allocations,
			s,
			"wallbox",
			"wallbox",
			take,
			"pv_surplus",
			["wallbox.presence"],
			[REASON.VEHICLE_PRESENCE_REQUIRED, REASON.PV_EXPECTED_BEFORE_DEADLINE, REASON.PV_SURPLUS_AVAILABLE],
			maxW,
		);
		remaining -= take;
		pvAllocated += take;
	}

	// Bei niedriger PV-Confidence und hartem Goal: konservativ zusätzlichen Importbedarf ansetzen
	if (wb.energyGoalHard && conf < 0.7 && remaining <= EPS) {
		const base = wb.requiredEnergyKwh ?? 0;
		remaining = Math.max(remaining, base * (1 - conf) * 0.4 * lossFactor);
	}

	if (remaining > EPS) {
		const importSlots = useSlots
			.filter((s) => s.gridAllowed && s.importCt !== null)
			.slice()
			.sort((a, b) => (a.importCt ?? 999) - (b.importCt ?? 999) || a.startIso.localeCompare(b.startIso));
		for (const s of importSlots) {
			if (remaining <= EPS) break;
			let take = remaining;
			if (maxW) take = Math.min(take, energyFromPowerW(maxW));
			if (minW && take > 0 && take < energyFromPowerW(minW)) take = energyFromPowerW(minW);
			if (maxW) take = Math.min(take, energyFromPowerW(maxW));
			pushAlloc(
				allocations,
				s,
				"wallbox",
				"wallbox",
				take,
				"grid",
				["wallbox.presence", "wallbox.energy_goal"],
				[
					REASON.VEHICLE_DEADLINE_REQUIRED,
					REASON.VEHICLE_PRESENCE_REQUIRED,
					conf < 0.7 ? REASON.GRID_IMPORT_CONSERVATIVE_DEADLINE : REASON.GRID_IMPORT_COST_OPTIMAL,
				],
				maxW,
			);
			remaining -= take;
		}
	}

	goals.push({
		consumerId: "wallbox",
		goalId: "energy_deadline",
		met: remaining <= 0.05,
		detailDe:
			remaining <= 0.05
				? "Fahrzeugziel im Plan gedeckt."
				: `Fahrzeugziel unvollständig, Rest ~${remaining.toFixed(2)} kWh.`,
	});
}

function allocateBatteryCharge(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	allocations: UnifiedAllocationCell[],
	socKwh: number,
	capacityKwh: number,
	reserveKwh: number,
	thermalReserveKwh: number,
): number {
	const bat = input.battery;
	if (!bat.allowedModes.includes("charge")) return socKwh;
	const maxSoc = bat.maxSocPct ?? 100;
	const targetKwh = capacityKwh * (maxSoc / 100);
	const maxChargeW = bat.maxChargePowerW;
	const eff = bat.chargeEfficiency ?? 1;
	let soc = socKwh;

	// Leave thermalReserveKwh of PV across horizon for thermal
	let pvLeftForBat = slots.reduce((a, s) => a + s.remainPvKwh, 0) - thermalReserveKwh;
	if (pvLeftForBat < 0) pvLeftForBat = 0;

	for (const s of slots) {
		if (soc >= targetKwh - EPS) break;
		if (pvLeftForBat <= EPS) break;
		const room = targetKwh - soc;
		let take = Math.min(s.remainPvKwh, room / eff, pvLeftForBat);
		if (maxChargeW) take = Math.min(take, energyFromPowerW(maxChargeW));
		take = takePv(s, take);
		if (take <= EPS) continue;
		const stored = take * eff;
		soc += stored;
		pvLeftForBat -= take;
		pushAlloc(
			allocations,
			s,
			"battery",
			"battery_charge",
			take,
			"pv_surplus",
			["battery.limits"],
			[REASON.BATTERY_SOC_TARGET, REASON.PV_SURPLUS_AVAILABLE],
			maxChargeW,
		);
	}
	// Never below reserve via discharge in this core (we don't discharge for thermal)
	if (soc < reserveKwh) {
		/* reserve protected — no action */
	}
	return soc;
}

function allocateThermal(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	allocations: UnifiedAllocationCell[],
	goals: UnifiedGoalStatus[],
): void {
	const th = input.thermal;
	if (!th || th.headroomEnergyKwh === null || th.headroomEnergyKwh <= EPS) {
		if (th) {
			goals.push({
				consumerId: "immersion_heater",
				goalId: "thermal_day",
				met: true,
				detailDe: "Kein thermischer Headroom.",
			});
		}
		return;
	}
	let remaining = th.headroomEnergyKwh;
	const maxW = th.availablePowerW;
	const minW = th.minPowerW ?? th.availablePowerW;

	// Prefer high surplus slots (PV-rich), never allocate from battery in this phase
	const ordered = slots
		.slice()
		.filter((s) => s.remainPvKwh > EPS || s.surplusKwh > EPS)
		.sort((a, b) => b.remainPvKwh - a.remainPvKwh || a.startIso.localeCompare(b.startIso));

	for (const s of ordered) {
		if (remaining <= EPS) break;
		let take = Math.min(s.remainPvKwh, remaining);
		if (minW && take > 0 && take < energyFromPowerW(minW)) {
			if (s.remainPvKwh >= energyFromPowerW(minW)) take = energyFromPowerW(minW);
			else continue;
		}
		if (maxW) take = Math.min(take, energyFromPowerW(maxW));
		take = takePv(s, take);
		if (take <= EPS) continue;
		pushAlloc(
			allocations,
			s,
			"immersion_heater",
			"immersion_heater",
			take,
			"pv_surplus",
			["thermal.flex"],
			[REASON.THERMAL_FLEX_AVAILABLE, REASON.PV_SURPLUS_AVAILABLE, REASON.MIN_POWER_SLOT],
			maxW,
		);
		remaining -= take;
	}

	goals.push({
		consumerId: "immersion_heater",
		goalId: "thermal_day",
		met: remaining <= th.headroomEnergyKwh * 0.15,
		detailDe:
			remaining <= EPS
				? "Thermischer Headroom aus PV geplant."
				: `Thermisch Rest ~${remaining.toFixed(2)} kWh (kein Batterie-Heizen bei PV≈0).`,
	});
}

function allocateClimate(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	allocations: UnifiedAllocationCell[],
): void {
	const cl = input.climate;
	if (!cl) return;
	// Pflicht-Komfort zuerst (zeitkritisch), dann verschiebbarer Flex
	const units = [...cl.units].sort((a, b) => Number(b.mandatoryComfort) - Number(a.mandatoryComfort));
	for (const u of units) {
		const maxW = u.typicalPowerW;
		if (maxW === null || !(maxW > 0)) continue; // kein erfundener Default-Power
		const slotEnergy = energyFromPowerW(maxW);
		let need = u.expectedEnergyKwh ?? (u.mandatoryComfort ? slotEnergy * 4 : 0);
		if (need <= EPS) continue;

		if (u.mandatoryComfort) {
			// Sofort / frühe Slots — auch Netz, wenn kein PV (Komfort vor PV-Verschiebung)
			for (const s of slots) {
				if (need <= EPS) break;
				let take = Math.min(need, slotEnergy);
				const fromPv = takePv(s, take);
				const fromGrid = take - fromPv;
				if (fromPv > EPS) {
					pushAlloc(
						allocations,
						s,
						u.unitId,
						"climate",
						fromPv,
						"pv_surplus",
						["climate.comfort"],
						[REASON.CLIMATE_FLEX, REASON.PV_SURPLUS_AVAILABLE],
						maxW,
					);
					need -= fromPv;
				}
				if (fromGrid > EPS && s.gridAllowed) {
					pushAlloc(
						allocations,
						s,
						u.unitId,
						"climate",
						fromGrid,
						"grid",
						["climate.comfort"],
						[REASON.CLIMATE_FLEX, REASON.GRID_IMPORT_COST_OPTIMAL],
						maxW,
					);
					need -= fromGrid;
				}
			}
			continue;
		}

		// Verschiebbar: PV-reiche Slots bevorzugen
		const ordered = slots.slice().sort((a, b) => b.remainPvKwh - a.remainPvKwh);
		for (const s of ordered) {
			if (need <= EPS) break;
			let take = Math.min(s.remainPvKwh, need, slotEnergy);
			take = takePv(s, take);
			if (take <= EPS) continue;
			pushAlloc(
				allocations,
				s,
				u.unitId,
				"climate",
				take,
				"pv_surplus",
				["climate.flex"],
				[REASON.CLIMATE_FLEX, REASON.PV_SURPLUS_AVAILABLE],
				maxW,
			);
			need -= take;
		}
	}
}

function allocateOtherFlex(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	allocations: UnifiedAllocationCell[],
): void {
	for (const o of input.otherFlex) {
		let need = o.requiredEnergyKwh ?? 0;
		if (need <= EPS) continue;
		for (const s of slots) {
			if (need <= EPS) break;
			if (o.availableWindows.length) {
				const ok = o.availableWindows.some((w) => w.startIso === s.startIso);
				if (!ok) continue;
			}
			let take = Math.min(s.remainPvKwh, need);
			if (o.minPowerW && take > 0 && take < energyFromPowerW(o.minPowerW)) continue;
			if (o.maxPowerW) take = Math.min(take, energyFromPowerW(o.maxPowerW));
			take = takePv(s, take);
			if (take <= EPS) continue;
			pushAlloc(
				allocations,
				s,
				o.consumerId,
				o.kind,
				take,
				"pv_surplus",
				[],
				[REASON.OTHER_FLEX, REASON.PV_SURPLUS_AVAILABLE],
				o.maxPowerW,
			);
			need -= take;
		}
	}
}

function buildBatteryTrajectory(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	allocations: UnifiedAllocationCell[],
	startSocKwh: number,
	capacityKwh: number,
): UnifiedBatteryTrajectoryPoint[] {
	const effC = input.battery.chargeEfficiency ?? 1;
	const effD = input.battery.dischargeEfficiency ?? 1;
	let soc = startSocKwh;
	const traj: UnifiedBatteryTrajectoryPoint[] = [];
	for (const s of slots) {
		let charge = 0;
		let discharge = 0;
		for (const a of allocations) {
			if (a.slot.startIso !== s.startIso) continue;
			if (a.kind === "battery_charge") charge += a.allocatedEnergyKwh * effC;
			if (a.kind === "battery_discharge") discharge += a.allocatedEnergyKwh / Math.max(effD, 0.1);
		}
		soc += charge - discharge;
		soc = Math.max(0, Math.min(capacityKwh, soc));
		traj.push({
			slotStartIso: s.startIso,
			socPct: capacityKwh > 0 ? round3((soc / capacityKwh) * 100) : null,
			chargeEnergyKwh: round3(charge),
			dischargeEnergyKwh: round3(discharge),
		});
	}
	return traj;
}

export function allocateUnifiedDayPlan(input: UnifiedDayPlannerInput): UnifiedDayPlan {
	const slots = buildSlots(input);
	const allocations: UnifiedAllocationCell[] = [];
	const goals: UnifiedGoalStatus[] = [];
	const constraints: UnifiedConstraint[] = deriveUnifiedHardConstraints(input);
	const reasonCodes: string[] = [REASON.HOUSE_LOAD_REQUIRED];

	if (input.pv.uncertainty.status === "degraded" || input.pv.uncertainty.status === "missing") {
		reasonCodes.push(REASON.PV_FORECAST_DEGRADED);
	}
	if (input.houseLoad.uncertainty.status === "degraded" || input.houseLoad.uncertainty.status === "missing") {
		reasonCodes.push(REASON.HOUSE_LOAD_DEGRADED);
	}
	if (input.prices.slots.some((s) => s.exportCtPerKwh === null)) {
		reasonCodes.push(REASON.EXPORT_TARIFF_UNKNOWN);
	}
	if (input.wallbox) {
		if (!input.wallbox.connectedNow || input.wallbox.presenceWindows.length === 0) {
			reasonCodes.push(REASON.VEHICLE_PRESENCE_UNKNOWN);
		} else if (input.wallbox.presenceWindows.length === 1) {
			// nur aktueller Slot — Zukunft unknown
			reasonCodes.push(REASON.VEHICLE_PRESENCE_UNKNOWN);
		}
	}
	if (input.battery.socPct === null || input.battery.usableCapacityKwh === null) {
		reasonCodes.push(REASON.BATTERY_TELEMETRY_MISSING);
	}

	const capacity = input.battery.usableCapacityKwh;
	const socPct = input.battery.socPct;
	const batteryKnown = capacity !== null && capacity > 0 && socPct !== null;
	let socKwh = batteryKnown ? (socPct / 100) * capacity : 0;
	const reservePct = input.battery.reserveSocPct ?? input.battery.minSocPct ?? 0;
	const reserveKwh = batteryKnown ? capacity * (reservePct / 100) : 0;

	// Phase A: Hauslast bereits in surplusKwh verrechnet
	const houseTotal = slots.reduce((a, s) => a + s.houseKwh, 0);
	const pvTotal = slots.reduce((a, s) => a + s.pvKwh, 0);

	// Phase B: Vehicle
	allocateVehicle(input, slots, allocations, goals);

	// Thermal reserve before battery fill (Phase C ordering)
	const thermalNeed = input.thermal?.headroomEnergyKwh ?? 0;
	const surplusAfterVehicle = slots.reduce((a, s) => a + s.remainPvKwh, 0);
	const batRoom = batteryKnown
		? Math.max(0, capacity * ((input.battery.maxSocPct ?? 100) / 100) - socKwh)
		: 0;
	const batNearFull = batteryKnown && socKwh >= capacity * 0.85;
	const thermalReserve = Math.min(
		thermalNeed,
		surplusAfterVehicle * (batNearFull || thermalNeed > batRoom * 0.5 ? 1 : 0.55),
	);

	// Phase D-ish: Battery charge only with known SOC/capacity (null ≠ 0 %)
	if (batteryKnown) {
		socKwh = allocateBatteryCharge(
			input,
			slots,
			allocations,
			socKwh,
			capacity,
			reserveKwh,
			thermalReserve,
		);
	}

	// Phase C: Thermal from remaining PV (never battery at PV≈0)
	allocateThermal(input, slots, allocations, goals);

	allocateClimate(input, slots, allocations);
	allocateOtherFlex(input, slots, allocations);

	// Phase F: Export = remaining PV
	let exportKwh = slots.reduce((a, s) => a + s.remainPvKwh, 0);
	if (exportKwh > 0.05) reasonCodes.push(REASON.EXPORT_UNAVOIDABLE);

	let importKwh = 0;
	let importCostCt = 0;
	let exportValueCt: number | null = 0;
	let exportValueUnknown = false;
	for (const a of allocations) {
		if (a.energySource === "grid" || a.energySource === "mixed") {
			importKwh += a.allocatedEnergyKwh;
			const slot = slots.find((s) => s.startIso === a.slot.startIso);
			if (slot?.importCt != null) importCostCt += a.allocatedEnergyKwh * slot.importCt;
		}
	}
	for (const s of slots) {
		if (s.remainPvKwh <= EPS) continue;
		if (s.exportCt === null) {
			exportValueUnknown = true;
		} else {
			exportValueCt! += s.remainPvKwh * s.exportCt;
		}
	}
	if (exportValueUnknown) exportValueCt = null;

	const traj = batteryKnown
		? buildBatteryTrajectory(input, slots, allocations, (socPct / 100) * capacity, capacity)
		: [];

	const confPct = input.pv.uncertainty.confidencePct;
	const degraded =
		input.pv.uncertainty.status !== "valid" ||
		input.houseLoad.uncertainty.status === "missing" ||
		!batteryKnown;
	const quality = operatorQuality(
		degraded
			? input.pv.uncertainty.status === "missing"
				? "missing"
				: "degraded"
			: "valid",
		`Unified allocation; PV confidence ${confPct ?? "n/a"}%.`,
		confPct,
	);

	return {
		schemaVersion: 1,
		planId: `unified-${input.time.nowIso}`,
		generation: 1,
		inputRevision: input.contributionRevision ?? 1,
		createdAtIso: input.time.nowIso,
		timezone: input.time.timezone,
		horizonStartIso: input.time.horizonStartIso,
		horizonEndIso: input.time.horizonEndIso,
		slotMinutes: 15,
		expectedPvEnergyKwh: round3(pvTotal),
		expectedHouseLoadEnergyKwh: round3(houseTotal),
		expectedGridImportEnergyKwh: round3(importKwh),
		expectedGridExportEnergyKwh: round3(exportKwh),
		// Exportvergütung unknown → nicht als 0-€-Gutschrift erfinden
		expectedCostCt: round3(exportValueCt === null ? importCostCt : importCostCt - exportValueCt),
		batteryTrajectory: traj,
		allocations: allocations.sort((a, b) => a.slot.startIso.localeCompare(b.slot.startIso)),
		goalStatuses: goals,
		constraints,
		reasonCodes: [...new Set(reasonCodes)],
		confidence: quality,
		totals: null,
		legacyDailyPlan: null,
	};
}
