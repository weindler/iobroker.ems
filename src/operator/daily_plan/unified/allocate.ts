/**
 * Unified Day Allocation Core (Schritt 2).
 *
 * Deterministisch: UnifiedDayPlannerInput → UnifiedDayPlan.
 * Keine KI, keine Live-Writes, keine Takeover.
 * Bestehende DailyPlan-allocation.ts bleibt Produktions-Pfad; dieser Core ist die
 * gemeinsame One-Plan-Bilanzschicht gegen Golden/ALLOC-Tests.
 */

import { operatorQuality } from "../../quality";
import { localDateKeyInTimezone } from "../../time";
import type {
	UnifiedAllocationCell,
	UnifiedBatteryTrajectoryPoint,
	UnifiedConstraint,
	UnifiedDayPlan,
	UnifiedDayPlannerInput,
	UnifiedVehicleChargeEconomics,
} from "./types";
import { deriveUnifiedHardConstraints } from "./types";
import { REASON } from "./reason_codes";
import { sumEnergyForLocalDay, sumEnergyToDeadline } from "./energy_scopes";
import { vehicleSlotAllocatable } from "./vehicle_availability";
import {
	buildSlots,
	EPS,
	runScoreBasedAllocation,
	type SlotWork,
} from "./score_allocate";

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function energyFromPowerW(powerW: number): number {
	return (powerW / 1000) * 0.25;
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
			// Flex-Verbraucher aus Batterie (Planung) — kein separates battery_discharge-Kind.
			if (
				a.kind !== "battery_charge" &&
				a.kind !== "battery_discharge" &&
				(a.energySource === "battery" || a.energySource === "mixed")
			) {
				discharge += a.allocatedEnergyKwh / Math.max(effD, 0.1);
			}
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

export type AllocateUnifiedOptions = {
	/** Fortlaufende Generation bei Replan (gleicher Tag). */
	generation?: number;
	extraReasonCodes?: string[];
	/**
	 * Vorheriger Plan: Allokationen mit slot.endIso <= now bleiben unverändert
	 * (Vergangenheit wird nicht umgeplant).
	 */
	previousPlan?: UnifiedDayPlan | null;
};

/** Nur Slots mit end > now — Rest-des-Tages-Horizon. */
export function trimUnifiedInputToRemainingHorizon(
	input: UnifiedDayPlannerInput,
	nowMs: number,
): UnifiedDayPlannerInput {
	const keep = (startIso: string, endIso: string): boolean => {
		const end = Date.parse(endIso);
		return Number.isFinite(end) && end > nowMs;
	};
	const slots = input.time.slots.filter((s) => keep(s.startIso, s.endIso));
	const slotKeys = new Set(slots.map((s) => s.startIso));
	return {
		...input,
		time: {
			...input.time,
			slots,
			horizonStartIso: slots[0]?.startIso ?? input.time.horizonStartIso,
			horizonEndIso: slots[slots.length - 1]?.endIso ?? input.time.horizonEndIso,
		},
		pv: { ...input.pv, slots: input.pv.slots.filter((s) => slotKeys.has(s.slot.startIso)) },
		houseLoad: {
			...input.houseLoad,
			slots: input.houseLoad.slots.filter((s) => slotKeys.has(s.slot.startIso)),
		},
		prices: {
			...input.prices,
			slots: input.prices.slots.filter((s) => slotKeys.has(s.slot.startIso)),
		},
	};
}

export function allocateUnifiedDayPlan(
	input: UnifiedDayPlannerInput,
	opts?: AllocateUnifiedOptions,
): UnifiedDayPlan {
	const nowMs = Date.parse(input.time.nowIso);
	const trimmed =
		Number.isFinite(nowMs) ? trimUnifiedInputToRemainingHorizon(input, nowMs) : input;
	const pastAllocations =
		opts?.previousPlan && Number.isFinite(nowMs)
			? opts.previousPlan.allocations.filter((a) => {
					const end = Date.parse(a.slot.endIso);
					return Number.isFinite(end) && end <= nowMs;
				})
			: [];

	const slots = buildSlots(trimmed);
	const constraints: UnifiedConstraint[] = deriveUnifiedHardConstraints(trimmed);
	const reasonCodes: string[] = [REASON.HOUSE_LOAD_REQUIRED, ...(opts?.extraReasonCodes ?? [])];

	if (trimmed.pv.uncertainty.status === "degraded" || trimmed.pv.uncertainty.status === "missing") {
		reasonCodes.push(REASON.PV_FORECAST_DEGRADED);
	}
	if (
		trimmed.houseLoad.uncertainty.status === "degraded" ||
		trimmed.houseLoad.uncertainty.status === "missing"
	) {
		reasonCodes.push(REASON.HOUSE_LOAD_DEGRADED);
	}
	if (trimmed.prices.slots.some((s) => s.exportCtPerKwh === null)) {
		reasonCodes.push(REASON.EXPORT_TARIFF_UNKNOWN);
	}
	if (trimmed.wallbox) {
		const hasUnknown = trimmed.wallbox.presenceWindows.some((w) => {
			const st = w.status ?? (w.available ? "available" : "unavailable");
			return st === "unknown";
		});
		const hasFutureAvailable = trimmed.wallbox.presenceWindows.some((w) => {
			const st = w.status ?? (w.available ? "available" : "unavailable");
			return st === "available" && Date.parse(w.endIso) > Date.parse(trimmed.time.nowIso);
		});
		if (hasUnknown || (!trimmed.wallbox.connectedNow && !hasFutureAvailable)) {
			reasonCodes.push(REASON.VEHICLE_PRESENCE_UNKNOWN);
		}
	}
	if (trimmed.battery.socPct === null || trimmed.battery.usableCapacityKwh === null) {
		reasonCodes.push(REASON.BATTERY_TELEMETRY_MISSING);
	}
	if (!trimmed.battery.dischargeLiveSupported) {
		constraints.push({
			id: "battery.discharge_unsupported",
			kind: "technical",
			hard: true,
			descriptionDe:
				"Battery Discharge Live nicht supported (z. B. Sonnen EM) — kein Discharge-Dispatch.",
		});
		reasonCodes.push(REASON.BATTERY_DISCHARGE_LIVE_UNSUPPORTED);
	}
	if (!trimmed.battery.passiveBatteryEnergyAvailable) {
		constraints.push({
			id: "battery.passive_energy_unavailable",
			kind: "technical",
			hard: true,
			descriptionDe:
				"Passive Batterie-Energiequelle nicht verlässlich (kein Self-Consumption / Manual/Hold/unbekannt).",
		});
		reasonCodes.push(REASON.BATTERY_PASSIVE_ENERGY_UNAVAILABLE);
	}

	const capacity = trimmed.battery.usableCapacityKwh;
	const socPct = trimmed.battery.socPct;
	const batteryKnown = capacity !== null && capacity > 0 && socPct !== null;
	const startSocKwh = batteryKnown ? (socPct / 100) * capacity : 0;
	const reservePct = trimmed.battery.reserveSocPct ?? trimmed.battery.minSocPct ?? 0;
	const minReserveKwh = batteryKnown ? capacity * (reservePct / 100) : 0;
	const nightReserveKwh =
		trimmed.battery.nightReserveKwh !== null && trimmed.battery.nightReserveKwh > EPS
			? trimmed.battery.nightReserveKwh
			: 0;
	const reserveKwh = Math.max(minReserveKwh, nightReserveKwh);
	if (nightReserveKwh > EPS) reasonCodes.push(REASON.BATTERY_NIGHT_RESERVE);

	const houseHorizonTotal = slots.reduce((a, s) => a + s.houseKwh, 0);
	const pvHorizonTotal = slots.reduce((a, s) => a + s.pvKwh, 0);

	const todayKey = localDateKeyInTimezone(
		new Date(Number.isFinite(nowMs) ? nowMs : Date.now()),
		trimmed.time.timezone,
	);
	const pvTodayFromSlots = sumEnergyForLocalDay(input.pv.slots, todayKey, trimmed.time.timezone);
	const houseTodayFromSlots = sumEnergyForLocalDay(
		input.houseLoad.slots,
		todayKey,
		trimmed.time.timezone,
	);
	const pvToday =
		trimmed.pv.expectedDayEnergyKwh !== null && Number.isFinite(trimmed.pv.expectedDayEnergyKwh)
			? trimmed.pv.expectedDayEnergyKwh
			: input.pv.slots.length > 0
				? pvTodayFromSlots
				: null;
	const houseToday =
		trimmed.houseLoad.expectedDayEnergyKwh !== null &&
		Number.isFinite(trimmed.houseLoad.expectedDayEnergyKwh)
			? trimmed.houseLoad.expectedDayEnergyKwh
			: input.houseLoad.slots.length > 0
				? houseTodayFromSlots
				: null;

	const goalDeadline = trimmed.wallbox?.deadlineIso ?? null;
	const pvToGoal = sumEnergyToDeadline(input.pv.slots, goalDeadline);

	const { allocations, goals, reasonCodes: allocReasons, finalSocKwh } = runScoreBasedAllocation(
		trimmed,
		slots,
		{
			initialSocKwh: startSocKwh,
			reserveKwh,
			reasonCodes,
		},
	);
	for (const c of allocReasons) reasonCodes.push(c);

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
		? buildBatteryTrajectory(trimmed, slots, allocations, startSocKwh, capacity)
		: [];

	const confPct = trimmed.pv.uncertainty.confidencePct;
	const degraded =
		trimmed.pv.uncertainty.status !== "valid" ||
		trimmed.houseLoad.uncertainty.status === "missing" ||
		!batteryKnown;
	const quality = operatorQuality(
		degraded
			? trimmed.pv.uncertainty.status === "missing"
				? "missing"
				: "degraded"
			: "valid",
		`Unified allocation; PV confidence ${confPct ?? "n/a"}%.`,
		confPct,
	);

	const mergedAllocations = [...pastAllocations, ...allocations].sort((a, b) =>
		a.slot.startIso.localeCompare(b.slot.startIso),
	);

	const vehicleChargeEconomics = buildVehicleChargeEconomics(trimmed, slots, allocations);

	return {
		schemaVersion: 1,
		planId: `unified-${trimmed.time.nowIso}`,
		generation: opts?.generation ?? 1,
		inputRevision: trimmed.contributionRevision ?? 1,
		createdAtIso: trimmed.time.nowIso,
		timezone: trimmed.time.timezone,
		horizonStartIso: trimmed.time.horizonStartIso,
		horizonEndIso: trimmed.time.horizonEndIso,
		slotMinutes: 15,
		expectedPvEnergyTodayKwh: pvToday === null ? null : round3(pvToday),
		expectedHouseLoadEnergyTodayKwh: houseToday === null ? null : round3(houseToday),
		expectedPvEnergyToGoalKwh: pvToGoal,
		expectedPvEnergyHorizonKwh: round3(pvHorizonTotal),
		expectedHouseLoadEnergyHorizonKwh: round3(houseHorizonTotal),
		expectedGridImportEnergyKwh: round3(importKwh),
		expectedGridExportEnergyKwh: round3(exportKwh),
		expectedCostCt: round3(exportValueCt === null ? importCostCt : importCostCt - exportValueCt),
		batteryTrajectory: traj,
		allocations: mergedAllocations,
		goalStatuses: goals,
		constraints,
		reasonCodes: [...new Set(reasonCodes)],
		confidence: quality,
		vehicleChargeEconomics,
		totals: null,
		legacyDailyPlan: null,
	};
}

function earliestFeasibleGridCostCt(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	gridNeedKwh: number,
): number | null {
	const wb = input.wallbox;
	if (!wb || gridNeedKwh <= EPS) return 0;
	const deadlineMs = wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY;
	const maxW = wb.maxChargePowerW;
	const minW = wb.minChargePowerW;
	const chrono = slots
		.filter(
			(s) =>
				s.gridAllowed &&
				s.importCt !== null &&
				Date.parse(s.startIso) < deadlineMs &&
				vehicleSlotAllocatable(wb, s.startIso),
		)
		.slice()
		.sort((a, b) => a.startIso.localeCompare(b.startIso));
	let remaining = gridNeedKwh;
	let cost = 0;
	for (const s of chrono) {
		if (remaining <= EPS) break;
		let take = remaining;
		if (maxW) take = Math.min(take, energyFromPowerW(maxW));
		if (minW && take > 0 && take < energyFromPowerW(minW)) {
			if (remaining >= energyFromPowerW(minW)) take = energyFromPowerW(minW);
			else break;
		}
		if (maxW) take = Math.min(take, energyFromPowerW(maxW));
		if (take <= EPS) continue;
		cost += take * (s.importCt as number);
		remaining -= take;
	}
	if (remaining > 0.05) return null;
	return round3(cost);
}

function buildVehicleChargeEconomics(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	allocations: UnifiedAllocationCell[],
): UnifiedVehicleChargeEconomics | null {
	const wb = input.wallbox;
	if (!wb) return null;
	const wbAlloc = allocations.filter((a) => a.kind === "wallbox");
	let pvKwh = 0;
	let gridKwh = 0;
	let gridCost = 0;
	let gridPricedKwh = 0;
	const slotCosts: Record<string, number> = {};
	for (const a of wbAlloc) {
		const slot = slots.find((s) => s.startIso === a.slot.startIso);
		if (a.energySource === "pv_surplus") pvKwh += a.allocatedEnergyKwh;
		if (a.energySource === "grid" || a.energySource === "mixed") {
			gridKwh += a.allocatedEnergyKwh;
			if (slot?.importCt != null) {
				const c = a.allocatedEnergyKwh * slot.importCt;
				gridCost += c;
				gridPricedKwh += a.allocatedEnergyKwh;
				slotCosts[a.slot.startIso] = round3(c);
			}
		}
	}
	const exportKnown = slots.some((s) => s.exportCt !== null);
	const required = wb.requiredEnergyKwh ?? 0;
	const loss = wb.chargeLossFactor ?? 1;
	const needKwh = required > EPS ? required * loss : 0;
	const unmetNeed = needKwh > EPS ? Math.max(0, needKwh - pvKwh - gridKwh) : 0;
	const neededImportButUnpriced = unmetNeed > 0.05 && gridKwh <= EPS;

	const optimizedGridComplete =
		!neededImportButUnpriced &&
		(gridKwh <= EPS || Math.abs(gridPricedKwh - gridKwh) <= 0.05);
	const optimizedCostCt: number | null = neededImportButUnpriced
		? null
		: gridKwh <= EPS
			? 0
			: optimizedGridComplete
				? round3(gridCost)
				: null;

	const earliestCostCt = neededImportButUnpriced
		? null
		: earliestFeasibleGridCostCt(input, slots, gridKwh);
	const comparable = optimizedCostCt !== null && earliestCostCt !== null;

	const savings = comparable ? round3(earliestCostCt - optimizedCostCt) : null;

	let completeness: UnifiedVehicleChargeEconomics["economicsCompleteness"] = "unknown";
	if (comparable) {
		completeness = exportKnown ? "full" : "grid_only";
	}

	return {
		deadlineIso: wb.deadlineIso,
		requiredEnergyKwh: wb.requiredEnergyKwh,
		expectedPvChargeKwh: round3(pvKwh),
		expectedGridChargeKwh: round3(gridKwh),
		expectedGridCostCt: optimizedCostCt,
		alternativeGridCostCt: earliestCostCt,
		savingsVsAlternativeCt: savings,
		exportTariffKnown: exportKnown,
		economicsCompleteness: completeness,
		baselineId: "earliest_feasible",
		slotCostsCtByStartIso: slotCosts,
	};
}
