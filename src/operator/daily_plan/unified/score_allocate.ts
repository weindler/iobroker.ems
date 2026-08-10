/**
 * Score-basierte iterative Unified-Allocation — kein fester Add-on-Phasen-Order.
 */

import { plannerModePolicyFromGlobalMode } from "../../../planner/mode_policy";
import type { PlannerModePolicy } from "../../../planner/mode_policy";
import {
	buildBatteryReserveFloor,
	reserveFloorAt,
	usableBatteryEnergyKwh,
	type BatteryReserveFloorPlan,
} from "./battery_reserve_floor";
import {
	applyHardPvBoundsToSlots,
	estimateHardPvBoundKwhBySlot,
	findNextReliablePvAfterCurrentWindow,
	resolveThermalPlannerEnergy,
	type HardPvBoundConsumer,
} from "./next_reliable_pv";
import { optimizeWeightsFromInput, type UnifiedOptimizeWeights } from "./optimize_weights";
import { REASON } from "./reason_codes";
import {
	collectPresenceReasonCodes,
	evaluateVehicleGoalFeasibility,
	vehicleSlotAllocatable,
} from "./vehicle_availability";
import type {
	UnifiedAllocationCell,
	UnifiedDayPlannerInput,
	UnifiedFlexConsumerKind,
	UnifiedGoalStatus,
} from "./types";

export const SLOT_H = 0.25;
export const EPS = 1e-6;

export type SlotWork = {
	startIso: string;
	endIso: string;
	/** Precomputed Date.parse(startIso) — Hot-Path ohne wiederholtes Parse. */
	startMs: number;
	pvKwh: number;
	houseKwh: number;
	surplusKwh: number;
	importCt: number | null;
	exportCt: number | null;
	gridAllowed: boolean;
	remainPvKwh: number;
};

export type AllocationEnergySource = UnifiedAllocationCell["energySource"];

export type AllocationCandidate = {
	slotIdx: number;
	consumerId: string;
	kind: UnifiedFlexConsumerKind;
	energyKwh: number;
	source: AllocationEnergySource;
	constraintIds: string[];
	reasonCodes: string[];
	maxPowerW: number | null;
	/** Optional: Deadline für Urgency-Scoring. */
	deadlineMs: number;
	mandatory: boolean;
	/** Konservatives Fahrzeug-Grid (niedrige PV-Confidence). */
	conservativeGrid: boolean;
};

type ConsumerState = {
	consumerId: string;
	kind: UnifiedFlexConsumerKind;
	remainingKwh: number;
	maxPowerW: number | null;
	minPowerW: number | null;
	deadlineMs: number;
	mandatory: boolean;
	gridEligible: boolean;
	pvFirst: boolean;
	batteryEligible: boolean;
	energyGoalHard: boolean;
	/** Klima: max. Verschiebung h. */
	maxShiftHours: number | null;
	/** Klima mandatory: früheste erlaubte Slot-Index-Grenze. */
	earliestSlotIdx: number;
	/** Nur vor thermischer Deadline score-boosten. */
	thermalBeforeDeadline: boolean;
	/**
	 * Puffer hält bis next reliable PV — kein Target-Zwang.
	 * Headroom bleibt als Soft-Flex für den Scorer (Surplus vs Export), nicht als Hard-Goal.
	 */
	thermalSoftOnly: boolean;
	/** Wallbox: Presence-Check pro Slot. */
	slotAllowed?: (slotStartIso: string) => boolean;
};

export type AllocationState = {
	slots: SlotWork[];
	/**
	 * End-SOC nach allen gebuchten Deltas (Diagnose / Charge-Need).
	 * Discharge/Charge-Feasibility nutzt projectedSocAt(slotIdx) — zeitkausal.
	 */
	socKwh: number;
	/** Start-SOC zu Planbeginn (Telemetrie). */
	initialSocKwh: number;
	/**
	 * Netto-SOC-Änderung pro Slot (nach Wirkungsgrad, chronologisch).
	 * Charge späterer Slots erhöht projectedSocAt früherer Slots nicht.
	 */
	socDeltaBySlot: number[];
	capacityKwh: number;
	/** Statischer Baseline-Floor (minSoc ∪ Night) — Charge-to-Reserve / Diagnose. */
	reserveKwh: number;
	/** Zeitabhängiger Reserve-Floor über den Horizon. */
	reserveFloor: BatteryReserveFloorPlan;
	batteryTargetKwh: number;
	chargeEff: number;
	dischargeEff: number;
	consumers: ConsumerState[];
	nowMs: number;
	batteryHold: boolean;
	dischargeLiveSupported: boolean;
	/** Self-Consumption passiv nutzbar? Sonst keine battery-Energiequelle für Verbraucher. */
	passiveBatteryEnergyAvailable: boolean;
	pvConfidence: number;
	modePolicy: PlannerModePolicy;
	/**
	 * Zusätzlicher Mode-MinSoc für Discharge (comfort/forced).
	 * 0 wenn Policy 100 % (= historisch „kein Defizit-Support“) — dann gilt nur der zeitabhängige Floor.
	 */
	modeDischargeMinKwh: number;
	/** Nächste belastbare PV nach Pflichtbindung — Soft-Thermal-Ökonomie. */
	nextReliablePvMs: number | null;
};

/** SOC am Ende von slotIdx nach chronologischer Propagation der gebuchten Deltas. */
export function projectedSocAt(state: AllocationState, slotIdx: number): number {
	let soc = state.initialSocKwh;
	const last = Math.min(slotIdx, state.socDeltaBySlot.length - 1);
	for (let i = 0; i <= last; i++) {
		soc += state.socDeltaBySlot[i] ?? 0;
		soc = Math.max(0, Math.min(state.capacityKwh, soc));
	}
	return soc;
}

function syncFinalSoc(state: AllocationState): void {
	state.socKwh =
		state.slots.length === 0
			? state.initialSocKwh
			: projectedSocAt(state, state.slots.length - 1);
}

function floorKwhAt(state: AllocationState, slotIdx: number): number {
	return reserveFloorAt(state.reserveFloor, slotIdx, state.reserveKwh);
}

/**
 * Effektiver Discharge-Floor für einen Zug: Maximum der noch kommenden
 * Reserve-Pflichten (ab now bis Recovery) ∪ Mode-MinSoc.
 * Verhindert, nachmittags „nächtlich abschmelzende“ Floors zu nutzen und so
 * die Nachtreserve vorzeitig zu verplanen.
 */
function dischargeFloorKwh(state: AllocationState, _slotIdx: number): number {
	let peak = state.modeDischargeMinKwh;
	const rec = state.reserveFloor.recoverySlotIdx;
	const last =
		rec !== null && rec >= 0
			? Math.min(state.slots.length - 1, Math.max(rec, 0))
			: state.slots.length - 1;
	for (let j = 0; j <= last; j++) {
		const slot = state.slots[j];
		if (!slot || slot.startMs < state.nowMs - 60_000) continue;
		peak = Math.max(peak, floorKwhAt(state, j));
	}
	return peak;
}

export type ScoreAllocationResult = {
	allocations: UnifiedAllocationCell[];
	goals: UnifiedGoalStatus[];
	reasonCodes: string[];
	finalSocKwh: number;
};

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

export function energyFromPowerW(powerW: number): number {
	return (powerW / 1000) * SLOT_H;
}

export function powerFromEnergyKwh(kwh: number): number {
	return (kwh / SLOT_H) * 1000;
}

function pvConfidenceFactor(input: UnifiedDayPlannerInput): number {
	const c = input.pv.uncertainty.confidencePct;
	if (c === null || !Number.isFinite(c)) return 1;
	return Math.max(0.2, Math.min(1, c / 100));
}

/** Observed vor Forecast — eine Welt pro Slot (NOW live-live oder forecast-forecast). */
function pickSlotPowerW(
	forecastPowerW: number | null | undefined,
	observedPowerW: number | null | undefined,
	energyKwh: number | null | undefined,
): { powerW: number | null; fromObserved: boolean } {
	if (observedPowerW != null && Number.isFinite(observedPowerW) && observedPowerW >= 0) {
		return { powerW: observedPowerW, fromObserved: true };
	}
	if (forecastPowerW != null && Number.isFinite(forecastPowerW)) {
		return { powerW: forecastPowerW, fromObserved: false };
	}
	if (energyKwh != null && Number.isFinite(energyKwh)) {
		return { powerW: powerFromEnergyKwh(energyKwh), fromObserved: false };
	}
	return { powerW: null, fromObserved: false };
}

export function buildSlots(input: UnifiedDayPlannerInput): SlotWork[] {
	const byStart = new Map<string, SlotWork>();
	const nowUsesLive = new Set<string>();
	for (const s of input.time.slots) {
		byStart.set(s.startIso, {
			startIso: s.startIso,
			endIso: s.endIso,
			startMs: Date.parse(s.startIso),
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
		const pick = pickSlotPowerW(p.forecastPowerW, p.observedPowerW, p.energyKwh);
		if (pick.powerW !== null) w.pvKwh = energyFromPowerW(pick.powerW);
		if (pick.fromObserved) nowUsesLive.add(p.slot.startIso);
	}
	for (const h of input.houseLoad.slots) {
		const w = byStart.get(h.slot.startIso);
		if (!w) continue;
		const pick = pickSlotPowerW(h.forecastPowerW, h.observedPowerW, h.energyKwh);
		if (pick.powerW !== null) w.houseKwh = energyFromPowerW(pick.powerW);
		if (!pick.fromObserved) nowUsesLive.delete(h.slot.startIso);
	}
	for (const pr of input.prices.slots) {
		const w = byStart.get(pr.slot.startIso);
		if (!w) continue;
		w.importCt = pr.importCtPerKwh;
		w.exportCt = pr.exportCtPerKwh;
		w.gridAllowed = pr.gridImportAllowed;
	}
	const slots = [...byStart.values()].sort((a, b) => a.startMs - b.startMs);
	for (const w of slots) {
		w.surplusKwh = Math.max(0, w.pvKwh - w.houseKwh);
		w.remainPvKwh = w.surplusKwh;
	}

	/*
	 * Runtime-Hold AC: bei Forecast-NOW (ohne Live-HL) reale Hold-Last von Surplus nehmen.
	 * Bei Live-HL ist AC bereits in observedHouse enthalten — keine Extra-Reserve.
	 */
	const nowMs = Date.parse(input.time.nowIso);
	const nowSlot = slots.find((s) => nowMs >= s.startMs && nowMs < Date.parse(s.endIso));
	if (nowSlot && input.climate && !nowUsesLive.has(nowSlot.startIso)) {
		for (const u of input.climate.units) {
			if (!u.runtimeHold) continue;
			const holdW = u.holdPowerW ?? u.typicalPowerW;
			if (holdW == null || !(holdW > 0)) continue;
			const e = energyFromPowerW(holdW);
			nowSlot.houseKwh += e;
			nowSlot.surplusKwh = Math.max(0, nowSlot.pvKwh - nowSlot.houseKwh);
			nowSlot.remainPvKwh = nowSlot.surplusKwh;
		}
	}
	return slots;
}

/** Bereits allokierte Energie eines Consumers in einem Slot (max. eine Zelle pro Slot). */
export function allocatedInSlotKwh(
	out: UnifiedAllocationCell[],
	consumerId: string,
	slotStartIso: string,
): number {
	const cell = out.find((a) => a.consumerId === consumerId && a.slot.startIso === slotStartIso);
	return cell?.allocatedEnergyKwh ?? 0;
}

/**
 * Schreibt/merged Allocation — maximal eine Zelle pro (consumerId, slot).
 * Verhindert Runtime-„duplicate“-Rejects im Daily-Plan-Merge.
 * @returns tatsächlich verbuchte Energie (0 wenn Slot schon voll).
 */
export function pushAlloc(
	out: UnifiedAllocationCell[],
	slot: SlotWork,
	consumerId: string,
	kind: UnifiedFlexConsumerKind,
	energyKwh: number,
	source: AllocationEnergySource,
	constraintIds: string[],
	reasonCodes: string[],
	maxPowerW: number | null,
): number {
	if (energyKwh <= EPS) return 0;
	let e = energyKwh;
	const existing = out.find((a) => a.consumerId === consumerId && a.slot.startIso === slot.startIso);
	const already = existing?.allocatedEnergyKwh ?? 0;
	if (maxPowerW !== null && maxPowerW > 0) {
		const cap = energyFromPowerW(maxPowerW);
		e = Math.min(e, Math.max(0, cap - already));
	}
	if (e <= EPS) return 0;

	if (existing) {
		existing.allocatedEnergyKwh = round3(already + e);
		existing.allocatedPowerW = round3(powerFromEnergyKwh(existing.allocatedEnergyKwh));
		if (existing.energySource !== source) existing.energySource = "mixed";
		for (const id of constraintIds) {
			if (!existing.constraintIds.includes(id)) existing.constraintIds.push(id);
		}
		for (const code of reasonCodes) {
			if (!existing.reasonCodes.includes(code)) existing.reasonCodes.push(code);
		}
		return e;
	}

	out.push({
		slot: { startIso: slot.startIso, endIso: slot.endIso },
		consumerId,
		kind,
		allocatedPowerW: round3(powerFromEnergyKwh(e)),
		allocatedEnergyKwh: round3(e),
		energySource: source,
		constraintIds: [...constraintIds],
		reasonCodes: [...reasonCodes],
	});
	return e;
}

export function takePv(slot: SlotWork, wantKwh: number): number {
	const take = Math.min(slot.remainPvKwh, wantKwh);
	slot.remainPvKwh = Math.max(0, slot.remainPvKwh - take);
	return take;
}

function resolveVehicleNeedKwh(input: UnifiedDayPlannerInput): number | null {
	const wb = input.wallbox;
	if (!wb) return null;
	if (wb.requiredEnergyKwh !== null && wb.requiredEnergyKwh > 0) return wb.requiredEnergyKwh;
	if (wb.targetSocPct !== null && wb.vehicleSocPct !== null && wb.vehicleCapacityKwh !== null) {
		return (Math.max(0, wb.targetSocPct - wb.vehicleSocPct) / 100) * wb.vehicleCapacityKwh;
	}
	return wb.fallbackEnergyNeedKwh;
}

function wallboxImmediate(wb: NonNullable<UnifiedDayPlannerInput["wallbox"]>): boolean {
	if (wb.batteryHoldRequested === true) return true;
	/** Nur Schnell/immediate → Batterie-Hold; min+PV ist PV-orientiert. */
	return wb.evccChargeMode === "now";
}

/**
 * Nicht-thermische Pflichtlasten für Opportunity-Surplus (vor next-PV / Reserve).
 * Thermal absichtlich ausgenommen — Bridge hängt von next-PV ab (keine Zirkularität).
 */
export function hardPvConsumersFromInput(input: UnifiedDayPlannerInput): HardPvBoundConsumer[] {
	const out: HardPvBoundConsumer[] = [];
	const wb = input.wallbox;
	if (wb?.energyGoalHard) {
		const need = resolveVehicleNeedKwh(input);
		const loss = wb.chargeLossFactor ?? 1;
		if (need !== null && need > EPS) {
			out.push({
				remainingKwh: need * loss,
				maxPowerW: wb.maxChargePowerW,
				deadlineMs: wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY,
				slotAllowed: (slotStartIso) => vehicleSlotAllocatable(wb, slotStartIso),
			});
		}
	}
	const cl = input.climate;
	if (cl) {
		for (const u of cl.units) {
			if (u.mandatoryComfort !== true) continue;
			const maxW = u.typicalPowerW;
			if (maxW === null || !(maxW > 0)) continue;
			const need = u.expectedEnergyKwh ?? energyFromPowerW(maxW) * 4;
			if (!(need > EPS)) continue;
			out.push({
				remainingKwh: need,
				maxPowerW: maxW,
				deadlineMs: Number.POSITIVE_INFINITY,
			});
		}
	}
	return out;
}

function hardPvBoundForPlanning(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
): number[] {
	const nowMs = Date.parse(input.time.nowIso);
	return estimateHardPvBoundKwhBySlot(slots, nowMs, hardPvConsumersFromInput(input));
}

function buildConsumerStates(input: UnifiedDayPlannerInput, slots: SlotWork[]): ConsumerState[] {
	const out: ConsumerState[] = [];
	const nowMs = Date.parse(input.time.nowIso);

	const wb = input.wallbox;
	if (wb) {
		const need = resolveVehicleNeedKwh(input);
		const loss = wb.chargeLossFactor ?? 1;
		if (need !== null && need > EPS) {
			const deadlineMs = wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY;
			const chargeMode = wb.evccChargeMode ?? null;
			const gridOk = chargeMode !== "pv" && chargeMode !== "off";
			out.push({
				consumerId: "wallbox",
				kind: "wallbox",
				remainingKwh: need * loss,
				maxPowerW: wb.maxChargePowerW,
				minPowerW: wb.minChargePowerW,
				deadlineMs,
				mandatory: wb.energyGoalHard,
				gridEligible: gridOk,
				pvFirst: chargeMode === "pv" || chargeMode === "minpv" || chargeMode === null,
				/** Batterie-Flex oberhalb Reserve-Floor — Anteil score-/recovery-basiert, keine %-Cap. */
				batteryEligible: chargeMode !== "off",
				energyGoalHard: wb.energyGoalHard,
				maxShiftHours: null,
				earliestSlotIdx: 0,
				thermalBeforeDeadline: false,
				thermalSoftOnly: false,
				slotAllowed: (slotStartIso) => vehicleSlotAllocatable(wb, slotStartIso),
			});
		}
	}

	const th = input.thermal;
	if (th && th.headroomEnergyKwh !== null && th.headroomEnergyKwh > EPS) {
		const deadlineMs = th.deadlineIso ? Date.parse(th.deadlineIso) : Number.NaN;
		const nowMsLocal = Date.parse(input.time.nowIso);
		const fromIdx = Math.max(
			0,
			slots.findIndex((s) => s.startMs + 15 * 60_000 > nowMsLocal),
		);
		const conf = pvConfidenceFactor(input);
		/** Fenster roh; Zuverlässigkeit nach nicht-thermischer Pflichtbindung. */
		const bound = hardPvBoundForPlanning(input, slots);
		const nextPv = findNextReliablePvAfterCurrentWindow(
			slots,
			fromIdx,
			conf,
			nowMsLocal,
			bound,
		);
		const emptyMs = th.estimatedEmptyAtIso ? Date.parse(th.estimatedEmptyAtIso) : Number.NaN;
		const bridge = resolveThermalPlannerEnergy({
			nowMs: nowMsLocal,
			bufferTempC: th.bufferTempC,
			minTempC: th.minTempC,
			headroomEnergyKwh: th.headroomEnergyKwh,
			coolingRateCPerH: th.coolingRateCPerH,
			estimatedEmptyAtMs: Number.isFinite(emptyMs) ? emptyMs : null,
			nextReliablePvMs: nextPv.startMs,
			pvConfidence01: conf,
		});
		const softOnly = bridge.coversUntilNextPv;
		/*
		 * Puffer hält bis nächster PV → kein Pflicht-Target-Fill (mandatory=false, softOnly).
		 * Headroom = Soft-Deckel; Score konkurriert wirtschaftlich mit Batterie/Export
		 * (kein Batterie-zuerst-Hardcode). Sonst Bridge-Energie.
		 */
		const plannedThermal = softOnly
			? Math.max(bridge.mandatoryEnergyKwh, th.headroomEnergyKwh ?? 0)
			: bridge.plannerEnergyKwh;
		if (plannedThermal > EPS) {
			const hardBridge = !softOnly && bridge.mandatoryEnergyKwh > EPS;
			out.push({
				consumerId: "immersion_heater",
				kind: "immersion_heater",
				remainingKwh: plannedThermal,
				maxPowerW: th.availablePowerW,
				minPowerW: th.minPowerW ?? th.availablePowerW,
				/** Soft/optional: keine Deadline-Urgency — reine Wirtschafts-Konkurrenz. */
				deadlineMs:
					softOnly || !Number.isFinite(deadlineMs)
						? Number.POSITIVE_INFINITY
						: deadlineMs,
				mandatory: hardBridge,
				gridEligible: false,
				pvFirst: true,
				/** Thermal darf Batterie nutzen, wenn Floor + Opportunity Cost es erlauben. */
				batteryEligible: !softOnly,
				energyGoalHard:
					hardBridge && (th.emptyAtSource === "learned" || bridge.mandatoryEnergyKwh > EPS),
				maxShiftHours: null,
				earliestSlotIdx: 0,
				thermalBeforeDeadline: Number.isFinite(deadlineMs) && !softOnly,
				thermalSoftOnly: softOnly,
			});
		}
	}

	const cl = input.climate;
	if (cl) {
		const nowSlotStart = slots.find((s) => nowMs >= s.startMs && nowMs < Date.parse(s.endIso))?.startIso;
		for (const u of cl.units) {
			const maxW = u.typicalPowerW;
			if (maxW === null || !(maxW > 0)) continue;
			const slotEnergy = energyFromPowerW(maxW);
			const isMandatory = u.mandatoryComfort === true;
			let need = u.expectedEnergyKwh ?? (isMandatory ? slotEnergy * 4 : 0);
			if (need <= EPS) continue;
			/*
			 * Pflicht-Komfort: kein künstliches now+2h-Deadline-Hard-Cutoff
			 * (sonst 00:05-Plan mit Slots ab 06:00 → 0 Klima). Urgency nur über Score.
			 * Runtime-Hold: keine zusätzliche Flex-Allocation im NOW-Slot.
			 */
			out.push({
				consumerId: u.unitId,
				kind: "climate",
				remainingKwh: need,
				maxPowerW: maxW,
				minPowerW: null,
				deadlineMs: Number.POSITIVE_INFINITY,
				mandatory: isMandatory,
				gridEligible: isMandatory,
				pvFirst: !isMandatory,
				/** Pflicht- und Flex-Klima konkurrieren um usableBatteryEnergy. */
				batteryEligible: true,
				energyGoalHard: isMandatory,
				maxShiftHours: u.maxShiftHours,
				earliestSlotIdx: 0,
				thermalBeforeDeadline: false,
				thermalSoftOnly: false,
				slotAllowed:
					u.runtimeHold === true && nowSlotStart
						? (slotStartIso) => slotStartIso !== nowSlotStart
						: undefined,
			});
		}
	}

	const bat = input.battery;
	const cap = bat.usableCapacityKwh;
	const socPct = bat.socPct;
	if (cap !== null && cap > 0 && socPct !== null && bat.allowedModes.includes("charge")) {
		const policy = plannerModePolicyFromGlobalMode(input.globalMode);
		/*
		 * Befund 004: dynamisches Endziel aus Contribution (`endSocTargetPct`) —
		 * nicht pauschal Mode-Policy 90/95/100. Explizites requiredChargeEnergyKwh=0
		 * bedeutet „kein Soft-SOC-Nachladen“ (nur Reserve-Lücke bleibt Pflicht).
		 */
		const endSoc =
			bat.endSocTargetPct != null && Number.isFinite(bat.endSocTargetPct)
				? bat.endSocTargetPct
				: policy.chargeTargetSocPct;
		const targetKwh = cap * (endSoc / 100);
		const reservePct = bat.reserveSocPct ?? bat.minSocPct ?? 0;
		const minReserve = cap * (reservePct / 100);
		const nightReserve =
			bat.nightReserveKwh !== null && bat.nightReserveKwh > EPS ? bat.nightReserveKwh : 0;
		const reserveKwh = Math.max(minReserve, nightReserve);
		const socKwh = (socPct / 100) * cap;
		let chargeNeed = 0;
		if (bat.requiredChargeEnergyKwh === 0) {
			chargeNeed = 0;
		} else if (bat.requiredChargeEnergyKwh !== null && bat.requiredChargeEnergyKwh > EPS) {
			chargeNeed = bat.requiredChargeEnergyKwh;
		} else {
			chargeNeed = Math.max(0, targetKwh - socKwh);
		}
		if (socKwh < reserveKwh - EPS) {
			chargeNeed = Math.max(chargeNeed, reserveKwh - socKwh);
		}
		if (chargeNeed > EPS) {
			const deadlineMs = bat.chargeDeadlineIso
				? Date.parse(bat.chargeDeadlineIso)
				: Number.POSITIVE_INFINITY;
			const chargeEff = bat.chargeEfficiency ?? 1;
			const reserveGap = socKwh < reserveKwh - EPS;
			const deficitNeed =
				bat.requiredChargeEnergyKwh !== null && bat.requiredChargeEnergyKwh > EPS;
			out.push({
				consumerId: "battery",
				kind: "battery_charge",
				remainingKwh: chargeNeed / Math.max(chargeEff, 0.1),
				maxPowerW: bat.maxChargePowerW,
				minPowerW: null,
				deadlineMs,
				mandatory: reserveGap || deficitNeed,
				/** Soft SOC-Ziel nur PV; Netz nur bei Reserve-/Defizit-Pflicht. */
				gridEligible: bat.gridChargeAllowed && (reserveGap || deficitNeed),
				pvFirst: true,
				batteryEligible: false,
				energyGoalHard: deficitNeed,
				maxShiftHours: null,
				earliestSlotIdx: 0,
				thermalBeforeDeadline: false,
				thermalSoftOnly: false,
			});
		}
	}

	for (const o of input.otherFlex) {
		const need = o.requiredEnergyKwh ?? 0;
		if (need <= EPS) continue;
		const deadlineMs = o.deadlineIso ? Date.parse(o.deadlineIso) : Number.POSITIVE_INFINITY;
		out.push({
			consumerId: o.consumerId,
			kind: o.kind,
			remainingKwh: need,
			maxPowerW: o.maxPowerW,
			minPowerW: o.minPowerW,
			deadlineMs,
			mandatory: false,
			gridEligible: o.gridEligible,
			pvFirst: o.pvFirst,
			batteryEligible: false,
			energyGoalHard: false,
			maxShiftHours: null,
			earliestSlotIdx: 0,
			thermalBeforeDeadline: false,
			thermalSoftOnly: false,
			slotAllowed: o.availableWindows.length
				? (slotStartIso) => o.availableWindows.some((w) => w.startIso === slotStartIso)
				: undefined,
		});
	}

	return out;
}

function maxChunkKwh(consumer: ConsumerState, slot: SlotWork): number {
	let chunk = consumer.remainingKwh;
	if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
		chunk = Math.min(chunk, energyFromPowerW(consumer.maxPowerW));
	}
	return chunk;
}

function applyMinPower(
	take: number,
	minW: number | null,
	available: number,
	remainingCap: number,
): number {
	if (take <= EPS) return 0;
	const capped = Math.min(take, remainingCap);
	if (minW && minW > 0) {
		const minE = energyFromPowerW(minW);
		if (capped + EPS < minE) {
			// Nie über remaining aufblasen — sonst gewinnt der Kandidat im Score,
			// apply verwirft ihn (Partial < Stufe) und die Iteration stagniert.
			return 0;
		}
		if (available + EPS < minE) return 0;
	}
	return capped;
}

/** Rest unter Mindestleistung ist nicht ausführbar → Consumer aus der Auswahl nehmen. */
function dropSubMinRemainder(consumers: ConsumerState[]): void {
	for (const c of consumers) {
		if (c.minPowerW === null || !(c.minPowerW > 0) || c.remainingKwh <= EPS) continue;
		if (c.remainingKwh + EPS < energyFromPowerW(c.minPowerW)) {
			c.remainingKwh = 0;
		}
	}
}

function horizonHours(slots: SlotWork[]): number {
	if (slots.length === 0) return 24;
	const a = slots[0]!.startMs;
	const b = slots[slots.length - 1]!.startMs + SLOT_H * 3600_000;
	return Math.max(1, (b - a) / 3600_000);
}

function slotUrgency(deadlineMs: number, slotStartMs: number, horizonH: number): number {
	if (!Number.isFinite(deadlineMs)) return 0;
	const hoursLeft = (deadlineMs - slotStartMs) / 3600_000;
	if (hoursLeft <= 0) return 2;
	return Math.max(0, 1.5 - hoursLeft / Math.max(horizonH, 6));
}

function ctCostPerKwh(importCt: number | null): number {
	if (importCt === null || !Number.isFinite(importCt)) return 0.35;
	return importCt * 0.01;
}

function peakFutureImportCt(state: AllocationState, fromSlotIdx: number): number {
	let peak = 0;
	for (let i = fromSlotIdx; i < state.slots.length; i++) {
		const ct = state.slots[i]!.importCt;
		if (ct !== null && ct > peak) peak = ct;
	}
	return peak > 0 ? peak : 35;
}

/**
 * Opportunity-Kosten einer Batterie-kWh jetzt (zeitabhängig bis PV-Recovery):
 * Ersatzkosten bis Recovery (niedrig bei starker PV, hoch bei Knappheit) + Roundtrip + Zyklus.
 * Verhindert „Batterie für Klima → PV exportieren“-Arbitrage, erlaubt aber Flex-Einsatz
 * wenn die kWh bald günstig wiederbeschafft werden kann.
 */
function batteryDischargeOpportunityScore(
	state: AllocationState,
	slotIdx: number,
	energyKwh: number,
	weights: UnifiedOptimizeWeights,
): number {
	const slot = state.slots[slotIdx]!;
	const replacementCt =
		state.reserveFloor.replacementCtBySlot[slotIdx] ?? peakFutureImportCt(state, slotIdx);
	const peakCt = peakFutureImportCt(state, slotIdx);
	/*
	 * Knappheit: wenn Ersatz ≈ Peak-Import, volle Vermeidungskosten.
	 * Starke Recovery (niedrige replacementCt): kWh weniger wertvoll → mehr Flex-Freigabe.
	 */
	const effectiveCt = Math.min(peakCt, Math.max(replacementCt, replacementCt * 0.5 + peakCt * 0.15));
	const replaceEur = (effectiveCt * 0.01) / Math.max(state.dischargeEff, 0.1);
	const roundtripFactor = Math.max(0, 1 - state.chargeEff * state.dischargeEff);
	const roundtripEur = replaceEur * roundtripFactor;
	const cycleEur = 0.05 * Math.max(0.05, weights.batteryCyclePenalty);
	const exportNowEur = exportOpportunityPerKwh(slot.exportCt);
	const modeMult =
		weights.batteryCyclePenalty >= 0.3 ? 1.35 : weights.batteryCyclePenalty <= 0.08 ? 0.85 : 1.0;
	const oppEur = Math.max(replaceEur + roundtripEur + cycleEur, exportNowEur + cycleEur + 0.02);
	return energyKwh * oppEur * weights.costWeight * 1.15 * modeMult;
}

function exportOpportunityPerKwh(exportCt: number | null): number {
	if (exportCt === null || !Number.isFinite(exportCt)) return 0.06;
	return exportCt * 0.01;
}

function pvBeforeDeadlineKwh(
	state: AllocationState,
	deadlineMs: number,
	slotAllowed?: (slotStartIso: string) => boolean,
): number {
	let sum = 0;
	for (const s of state.slots) {
		if (s.startMs >= deadlineMs) break;
		if (slotAllowed && !slotAllowed(s.startIso)) continue;
		sum += s.remainPvKwh;
	}
	return sum;
}

/** Verbleibende lieferbare PV-Kapazität vor Deadline vs. Restbedarf (Starvation-Druck). */
function thermalFeasibility(
	state: AllocationState,
	consumer: ConsumerState,
): { capKwh: number; pressure: number; peakRemainPv: number; slotsN: number } {
	const minE =
		consumer.minPowerW && consumer.minPowerW > 0 ? energyFromPowerW(consumer.minPowerW) : 0.05;
	const maxSlotE =
		consumer.maxPowerW && consumer.maxPowerW > 0 ? energyFromPowerW(consumer.maxPowerW) : minE;
	let capKwh = 0;
	let slotsN = 0;
	let peakRemainPv = 0;
	for (const s of state.slots) {
		if (s.startMs < state.nowMs - 60_000) continue;
		if (s.startMs >= consumer.deadlineMs) break;
		if (consumer.slotAllowed && !consumer.slotAllowed(s.startIso)) continue;
		peakRemainPv = Math.max(peakRemainPv, s.remainPvKwh);
		const add = Math.min(maxSlotE, s.remainPvKwh);
		if (add + EPS >= minE) {
			capKwh += add;
			slotsN += 1;
		}
	}
	const pressure = consumer.remainingKwh / Math.max(capKwh, EPS);
	return { capKwh, pressure, peakRemainPv, slotsN };
}

/** Bewertet einen Einzel-Kandidaten (höher = besser). -Infinity = hart unzulässig. */
export function scoreCandidate(
	input: UnifiedDayPlannerInput,
	state: AllocationState,
	candidate: AllocationCandidate,
	weights: UnifiedOptimizeWeights,
): number {
	const slot = state.slots[candidate.slotIdx];
	if (!slot || candidate.energyKwh <= EPS) return -Infinity;

	const consumer = state.consumers.find((c) => c.consumerId === candidate.consumerId);
	if (!consumer || consumer.remainingKwh <= EPS) return -Infinity;

	if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso)) return -Infinity;
	if (slot.startMs >= consumer.deadlineMs) return -Infinity;
	if (candidate.slotIdx < consumer.earliestSlotIdx) return -Infinity;

	if (candidate.kind === "battery_discharge") return -Infinity;

	if (candidate.source === "grid") {
		if (!slot.gridAllowed || slot.importCt === null) return -Infinity;
		if (!consumer.gridEligible) return -Infinity;
		if (!weights.allowOptimization && input.globalMode === "off") return -Infinity;
	}

	if (candidate.source === "pv_surplus") {
		if (slot.remainPvKwh + EPS < candidate.energyKwh) return -Infinity;
		if (candidate.kind === "battery_charge" && !weights.allowPvCharge) return -Infinity;
	}

	if (candidate.source === "battery") {
		if (!state.passiveBatteryEnergyAvailable) return -Infinity;
		if (!consumer.batteryEligible) return -Infinity;
		if (!weights.allowOptimization) return -Infinity;
		const floor = dischargeFloorKwh(state, candidate.slotIdx);
		const draw = candidate.energyKwh / Math.max(state.dischargeEff, 0.1);
		const socAt = projectedSocAt(state, candidate.slotIdx);
		if (socAt - draw < floor - EPS) return -Infinity;
		const usable = usableBatteryEnergyKwh(socAt, floor, state.dischargeEff);
		if (usable + EPS < candidate.energyKwh) return -Infinity;
		/*
		 * Keine Batterie-Entladung solange derselbe Slot noch PV-Surplus hat —
		 * sonst entsteht künstliche Export-Arbitrage (PV einspeisen, Klima aus Batterie).
		 */
		const need = Math.min(candidate.energyKwh, consumer.remainingKwh);
		if (slot.remainPvKwh + EPS >= need) return -Infinity;
		/*
		 * Wallbox: in PV-Surplus-Slots nicht aus Batterie (auch wenn remainPv schon
		 * von battery_charge verbraucht wurde — sonst Roundtrip statt Direktladung).
		 */
		if (candidate.kind === "wallbox" && slot.surplusKwh > 0.05) return -Infinity;
	}

	if (state.batteryHold && candidate.kind === "battery_charge") return -Infinity;

	if (
		candidate.kind === "immersion_heater" &&
		candidate.source !== "pv_surplus" &&
		candidate.source !== "battery"
	) {
		return -Infinity;
	}
	if (candidate.kind === "immersion_heater" && !weights.allowThermalAuto) return -Infinity;

	const e = Math.min(candidate.energyKwh, consumer.remainingKwh);
	const slotMs = slot.startMs;
	const horizonH = horizonHours(state.slots);
	const urg = slotUrgency(consumer.deadlineMs, slotMs, horizonH);

	let priority = 0.85;
	if (candidate.kind === "wallbox") {
		priority = consumer.energyGoalHard ? 4.2 * weights.vehicleUrgencyBoost : 2.4 * weights.vehicleUrgencyBoost;
	} else if (candidate.kind === "climate" && consumer.mandatory) {
		priority = 2.6 * weights.comfortWeight;
	} else if (candidate.kind === "immersion_heater") {
		if (consumer.thermalBeforeDeadline) {
			priority = 1.75 * weights.thermalDeadlineWeight;
		} else if (consumer.thermalSoftOnly) {
			/** Soft: Peer zu Flex/Batterie-Charge — Wirtschaftlichkeit im Score, nicht Komfort-Boost. */
			priority = 1.0 * weights.flexShiftWeight;
		} else {
			priority = 1.25 * weights.comfortWeight;
		}
	} else if (candidate.kind === "battery_charge") {
		priority =
			state.socKwh < state.reserveKwh - EPS
				? 2.1 * weights.reserveProtectWeight
				: 1.05 * weights.socTargetWeight;
	} else if (candidate.kind === "climate") {
		priority = 0.95 * weights.flexShiftWeight;
	}

	let score = e * priority * 0.38;
	/*
	 * Deadline-Urgency: globaler Restbedarf (nicht Slot-Nähe zur Deadline).
	 * Sonst gewinnen teure Spät-Slots gegen günstige Früh-Slots.
	 */
	const needUrgency = Number.isFinite(consumer.deadlineMs)
		? Math.max(0.15, Math.min(1.8, consumer.remainingKwh / Math.max(e, 0.25)))
		: 0;
	if (candidate.source !== "grid") {
		score += e * urg * weights.deadlineWeight * (consumer.energyGoalHard ? 0.5 : 0.12);
	} else {
		score += e * needUrgency * 0.08 * weights.deadlineWeight;
	}

	if (candidate.kind === "wallbox") {
		const pvRem = pvBeforeDeadlineKwh(state, consumer.deadlineMs, consumer.slotAllowed);
		const safePv = pvRem * state.pvConfidence;
		if (candidate.source === "grid" && state.pvConfidence >= 0.7 && safePv + EPS >= consumer.remainingKwh) {
			score -= e * 4.5 * weights.costWeight;
		} else if (candidate.source === "grid" && state.pvConfidence >= 0.7 && safePv > EPS) {
			score -= e * Math.max(0, consumer.remainingKwh - safePv) * 0.05 * weights.costWeight;
		}
		if (candidate.source === "pv_surplus") {
			score += e * 0.55 * weights.pvOpportunityWeight;
			if (pvRem > EPS) score += e * 0.25;
		}
		if (consumer.energyGoalHard && state.pvConfidence < 0.7 && candidate.source === "grid") {
			score += e * (0.7 - state.pvConfidence) * weights.deadlineWeight * 0.35;
		}
		/** Netzbedarf: günstige Slots stark bevorzugen (marginale ct). */
		if (candidate.source === "grid" && slot.importCt !== null) {
			const deficit = Math.max(0, consumer.remainingKwh - safePv);
			if (deficit > EPS || state.pvConfidence < 0.7) {
				score += e * 1.1 * weights.deadlineWeight;
			}
			score -= e * (slot.importCt / 100) * weights.costWeight * 2.8;
		}
	}

	if (candidate.kind === "immersion_heater") {
		if (consumer.thermalSoftOnly) {
			/*
			 * Optionale Wärme (Bridge bis next-PV bereits gedeckt): kein Basis-Prioritäts-Push.
			 * Wert skaliert mit post-PV-Kühlbrücke (emptyAt − Recovery): kurz → wenig Nutzen
			 * für Target-Fill; lang (z. B. Leerung abends nach Morgen-PV) → Speichern sinnvoll.
			 * Opportunity vs. PV→Batterie über gemeinsamen Peak-/SOC-Wert — kein Hardcode.
			 */
			if (candidate.source !== "pv_surplus") return -Infinity;
			score -= e * priority * 0.38;
			const peakEur = peakFutureImportCt(state, candidate.slotIdx) * 0.01;
			const socAt = projectedSocAt(state, candidate.slotIdx);
			const batRoom = Math.max(
				0,
				Math.min(state.capacityKwh - socAt, state.batteryTargetKwh - socAt),
			);
			const batConsumer = state.consumers.find((c) => c.kind === "battery_charge");
			const batStillWants = batConsumer != null && batConsumer.remainingKwh > 0.4;
			const recMs = state.nextReliablePvMs;
			const emptyMs = input.thermal?.estimatedEmptyAtIso
				? Date.parse(input.thermal.estimatedEmptyAtIso)
				: Number.NaN;
			const postPvBridgeH =
				recMs != null && Number.isFinite(emptyMs) && emptyMs > recMs
					? (emptyMs - recMs) / 3600_000
					: 0;
			/** 0…1: Kühlbrücke nach next-PV (emptyAt − nextReliablePv), keine Uhrzeit-Heuristik. */
			const needScale = Math.max(0, Math.min(1, postPvBridgeH / 10));
			const storeEur = peakEur * weights.costWeight * (0.25 + 0.55 * needScale);
			score += e * storeEur;
			if (batRoom > 0.4 || batStillWants) {
				score -= e * peakEur * weights.costWeight * weights.socTargetWeight * 0.65;
			}
		} else if (consumer.thermalBeforeDeadline && slotMs < consumer.deadlineMs) {
			score += e * weights.thermalDeadlineWeight * 0.42;
			/*
			 * Kontinuierliche Feasibility-Pressure (kein if pressure≥X-Sprung):
			 * pressure = remaining / lieferbare PV-Kapazität vor Deadline.
			 * slackWeight→1 bei viel Kapazität, tightWeight→1 bei Knappheit.
			 */
			const feas = thermalFeasibility(state, consumer);
			const pressure = Math.max(0, feas.pressure);
			const slackWeight = 1 / (1 + pressure);
			const tightWeight = pressure / (1 + pressure);
			const hoursToDeadline = (consumer.deadlineMs - slotMs) / 3600_000;
			const slackH = Math.max(SLOT_H, (consumer.deadlineMs - Math.max(slotMs, state.nowMs)) / 3600_000);
			const needH =
				consumer.remainingKwh / Math.max((consumer.maxPowerW ?? 1700) / 1000, EPS);
			const timePressure = needH / slackH;
			/** Earliness relativ zur Deadline-Restzeit — keine feste Stundenkonstante. */
			const horizonToDeadlineMs = Math.max(
				SLOT_H * 3600_000,
				consumer.deadlineMs - state.nowMs,
			);
			const earliness = Math.max(0, 1 - (slotMs - state.nowMs) / horizonToDeadlineMs);
			if (hoursToDeadline > 1) {
				score +=
					e *
					slackWeight *
					Math.min(1.0, hoursToDeadline / Math.max(horizonH, 8)) *
					0.12;
			}
			score +=
				e *
				weights.thermalDeadlineWeight *
				tightWeight *
				(0.55 * Math.min(2.0, pressure) +
					0.35 * Math.min(2.0, timePressure) +
					0.4 * earliness);
			if (slot.remainPvKwh > EPS && feas.peakRemainPv > EPS) {
				score -=
					e * tightWeight * (slot.remainPvKwh / feas.peakRemainPv) * 0.15;
			}
		}
		if (!consumer.thermalSoftOnly) {
			if (slot.remainPvKwh > EPS && slot.surplusKwh > EPS) {
				score +=
					e *
					(slot.remainPvKwh / Math.max(slot.surplusKwh, EPS)) *
					weights.flexShiftWeight *
					0.28;
			}
			/** Volle Mindeststufe belohnen. */
			if (consumer.minPowerW && e + EPS >= energyFromPowerW(consumer.minPowerW)) {
				score += 0.08;
			}
			/*
			 * Thermischer Flexspeicher: bei PV und Batterie über Reserve-Floor
			 * Wärme vorladen → spätere elektrische Flexibilität. Bei hartem Fahrzeugziel
			 * PV bewusst freigeben (kein festes Add-on-Ranking — Score).
			 */
			if (candidate.source === "pv_surplus") {
				const floor = dischargeFloorKwh(state, candidate.slotIdx);
				const socAt = projectedSocAt(state, candidate.slotIdx);
				const batAboveFloor = socAt > floor + 0.5;
				const batNearTarget =
					state.batteryTargetKwh > EPS && socAt + 0.25 >= state.batteryTargetKwh;
				const wbC = state.consumers.find((c) => c.kind === "wallbox");
				const hardVehicle =
					wbC != null && wbC.energyGoalHard && wbC.remainingKwh > 1.0;
				if (batAboveFloor && (batNearTarget || socAt >= state.capacityKwh * 0.8)) {
					score += e * weights.flexShiftWeight * 0.42;
				}
				if (hardVehicle) {
					score -= e * weights.vehicleUrgencyBoost * 0.65;
				}
				const slotEndMs = Date.parse(slot.endIso);
				if (
					input.preferImmersionLiveSurplusNow === true &&
					Number.isFinite(slotEndMs) &&
					slotMs <= state.nowMs &&
					state.nowMs < slotEndMs
				) {
					score += e * weights.flexShiftWeight * 2.4 + 0.55;
				}
			}
		}
	}

	if (candidate.kind === "climate") {
		if (consumer.mandatory) {
			const earliness = Math.max(0, 1 - (slotMs - state.nowMs) / (2 * 3600_000));
			score += e * weights.comfortWeight * (0.35 + earliness * 0.25);
		} else if (slot.remainPvKwh > EPS) {
			const pvRich = slot.remainPvKwh / Math.max(energyFromPowerW(consumer.maxPowerW ?? 900), EPS);
			score += e * Math.min(1.2, pvRich) * weights.flexShiftWeight * 0.22;
		}
	}

	if (candidate.kind === "battery_charge") {
		const socBefore = projectedSocAt(state, candidate.slotIdx);
		const room = state.batteryTargetKwh - socBefore;
		if (room > EPS) {
			score += e * (Math.min(e, room) / room) * weights.socTargetWeight * 0.28;
		}
		if (socBefore < state.reserveKwh - EPS) {
			score += e * weights.reserveProtectWeight * 0.35;
		}
		if (candidate.source === "pv_surplus" && weights.batterySurplusMinFactor > 1) {
			const pvRatio = slot.remainPvKwh / Math.max(slot.surplusKwh, EPS);
			if (pvRatio < 0.5) score -= e * (weights.batterySurplusMinFactor - 1) * 0.12;
		}
		if (candidate.source === "grid" && socBefore >= state.reserveKwh - EPS) {
			score -= e * 0.06 * weights.costWeight;
		}
	}

	if (candidate.source === "grid" && candidate.kind !== "wallbox") {
		score -= e * ctCostPerKwh(slot.importCt) * weights.costWeight;
	}

	if (candidate.source === "pv_surplus") {
		score -= e * exportOpportunityPerKwh(slot.exportCt) * weights.pvOpportunityWeight;
	}

	if (candidate.source === "battery") {
		score -= batteryDischargeOpportunityScore(state, candidate.slotIdx, e, weights);
		/** Harte Deadlines: Batterie-Flex etwas belohnen, wenn Recovery die kWh ersetzt. */
		if (consumer.energyGoalHard || consumer.thermalBeforeDeadline) {
			const repl = state.reserveFloor.replacementCtBySlot[candidate.slotIdx] ?? 28;
			if (repl < 12) score += e * 0.22 * weights.deadlineWeight;
		}
	}

	if (candidate.conservativeGrid) score += e * 0.1 * weights.deadlineWeight;

	return score;
}

function reasonCodesForCandidate(
	input: UnifiedDayPlannerInput,
	candidate: AllocationCandidate,
	state: AllocationState,
	wbPresenceCodes: string[],
): string[] {
	const codes: string[] = [];
	const slot = state.slots[candidate.slotIdx]!;

	if (candidate.kind === "wallbox") {
		codes.push(REASON.VEHICLE_PRESENCE_REQUIRED);
		if (candidate.source === "pv_surplus") {
			codes.push(REASON.PV_EXPECTED_BEFORE_DEADLINE, REASON.PV_SURPLUS_AVAILABLE, REASON.VEHICLE_PV_WINDOW_AVAILABLE);
			codes.push(...wbPresenceCodes.filter((c) => /predicted|explicit|available_now/.test(c)));
		}
		if (candidate.source === "grid") {
			codes.push(REASON.VEHICLE_DEADLINE_REQUIRED, REASON.VEHICLE_IMPORT_WINDOW_AVAILABLE);
			codes.push(
				candidate.conservativeGrid || state.pvConfidence < 0.7
					? REASON.GRID_IMPORT_CONSERVATIVE_DEADLINE
					: REASON.GRID_IMPORT_COST_OPTIMAL,
			);
		}
		if (candidate.source === "battery") {
			codes.push(REASON.BATTERY_FROM_RESERVE_FLEX, REASON.VEHICLE_DEADLINE_REQUIRED);
		}
	}
	if (candidate.kind === "immersion_heater") {
		codes.push(REASON.THERMAL_FLEX_AVAILABLE, REASON.MIN_POWER_SLOT);
		if (candidate.source === "pv_surplus") codes.push(REASON.PV_SURPLUS_AVAILABLE);
		if (candidate.source === "battery") codes.push(REASON.BATTERY_FROM_RESERVE_FLEX);
		if (input.thermal?.deadlineIso && slot.startMs < Date.parse(input.thermal.deadlineIso)) {
			codes.push(REASON.THERMAL_DEADLINE_PV_WINDOW);
		}
	}
	if (candidate.kind === "climate") {
		codes.push(REASON.CLIMATE_FLEX);
		if (candidate.source === "pv_surplus") codes.push(REASON.PV_SURPLUS_AVAILABLE);
		if (candidate.source === "grid") codes.push(REASON.GRID_IMPORT_COST_OPTIMAL);
		if (candidate.source === "battery") codes.push(REASON.BATTERY_FROM_RESERVE_FLEX);
	}
	if (candidate.kind === "battery_charge") {
		codes.push(REASON.BATTERY_SOC_TARGET, REASON.PV_SURPLUS_AVAILABLE);
		if (candidate.source === "grid") {
			codes.push(REASON.GRID_IMPORT_COST_OPTIMAL);
			const bat = input.battery;
			codes.push(
				bat.chargeDeadlineIso ? REASON.BATTERY_CHARGE_DEADLINE : REASON.BATTERY_RESERVE_PROTECTED,
			);
		}
	}
	if (candidate.kind === "other") {
		codes.push(REASON.OTHER_FLEX, REASON.PV_SURPLUS_AVAILABLE);
	}
	return codes;
}

function constraintIdsForCandidate(candidate: AllocationCandidate): string[] {
	switch (candidate.kind) {
		case "wallbox":
			return candidate.source === "grid"
				? ["wallbox.presence", "wallbox.energy_goal"]
				: ["wallbox.presence"];
		case "immersion_heater":
			return candidate.constraintIds.length
				? candidate.constraintIds
				: ["thermal.flex"];
		case "climate":
			return candidate.mandatory ? ["climate.comfort"] : ["climate.flex"];
		case "battery_charge":
			return ["battery.limits"];
		default:
			return candidate.constraintIds;
	}
}

function generateCandidatesForConsumer(
	input: UnifiedDayPlannerInput,
	state: AllocationState,
	consumer: ConsumerState,
	slotIdx: number,
	wbPresenceCodes: string[],
	allocations: UnifiedAllocationCell[],
	weights: UnifiedOptimizeWeights,
): AllocationCandidate[] {
	const slot = state.slots[slotIdx]!;
	if (consumer.remainingKwh <= EPS) return [];
	if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso)) return [];
	if (slot.startMs >= consumer.deadlineMs) return [];
	if (slotIdx < consumer.earliestSlotIdx) return [];

	const already = allocatedInSlotKwh(allocations, consumer.consumerId, slot.startIso);
	if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
		const headroom = energyFromPowerW(consumer.maxPowerW) - already;
		if (headroom <= EPS) return [];
	}

	let chunk = maxChunkKwh(consumer, slot);
	if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
		chunk = Math.min(chunk, Math.max(0, energyFromPowerW(consumer.maxPowerW) - already));
	}
	if (chunk <= EPS) return [];

	const out: AllocationCandidate[] = [];
	const sources: AllocationEnergySource[] = [];

	/*
	 * PV-Surplus für alle Flex-Verbraucher inkl. Wallbox (auch Modus now) —
	 * sonst Grid-Strafe „PV reicht vor Deadline“ ohne PV-Kandidat → Ziel unerreicht.
	 */
	if (slot.remainPvKwh > EPS) sources.push("pv_surplus");
	if (consumer.gridEligible && slot.gridAllowed && slot.importCt !== null) {
		sources.push("grid");
	}
	const batFloor = dischargeFloorKwh(state, slotIdx);
	const usableBat = usableBatteryEnergyKwh(
		projectedSocAt(state, slotIdx),
		batFloor,
		state.dischargeEff,
	);
	if (
		consumer.batteryEligible &&
		usableBat > EPS &&
		// PV im Slot deckt den Chunk → keine Batterie-Kandidaten (Export-Arbitrage).
		slot.remainPvKwh + EPS < Math.min(chunk, consumer.remainingKwh)
	) {
		sources.push("battery");
	}

	if (consumer.kind === "immersion_heater") {
		sources.length = 0;
		const minE =
			consumer.minPowerW && consumer.minPowerW > 0 ? energyFromPowerW(consumer.minPowerW) : 0;
		// Keine Teil-Slots unter Mindeststufe (sonst Runtime stage 0).
		if (slot.remainPvKwh + EPS >= Math.max(minE, EPS)) sources.push("pv_surplus");
		const pvBeforeDl = pvBeforeDeadlineKwh(state, consumer.deadlineMs, consumer.slotAllowed);
		const thermalNeedsBattery =
			consumer.thermalBeforeDeadline &&
			pvBeforeDl + EPS < consumer.remainingKwh &&
			usableBat + EPS >= Math.max(minE, EPS) &&
			slot.remainPvKwh + EPS < Math.max(minE, EPS);
		if (thermalNeedsBattery) sources.push("battery");
	}

	if (consumer.kind === "battery_charge") {
		sources.length = 0;
		if (slot.remainPvKwh > EPS && state.modePolicy.allowPvCharge) sources.push("pv_surplus");
		if (consumer.gridEligible && slot.gridAllowed && slot.importCt !== null) sources.push("grid");
	}

	for (const source of sources) {
		let take = chunk;
		if (source === "pv_surplus") {
			take = Math.min(take, slot.remainPvKwh);
			take = applyMinPower(take, consumer.minPowerW, slot.remainPvKwh, consumer.remainingKwh);
		} else if (source === "battery") {
			take = Math.min(take, usableBat);
			take = applyMinPower(take, consumer.minPowerW, take, consumer.remainingKwh);
		} else {
			take = applyMinPower(take, consumer.minPowerW, take, consumer.remainingKwh);
		}
		if (take <= EPS) continue;
		if (
			consumer.minPowerW &&
			consumer.minPowerW > 0 &&
			take + EPS < energyFromPowerW(consumer.minPowerW)
		) {
			continue;
		}

		const conservativeGrid =
			consumer.kind === "wallbox" &&
			source === "grid" &&
			consumer.energyGoalHard &&
			state.pvConfidence < 0.7;

		const base: AllocationCandidate = {
			slotIdx,
			consumerId: consumer.consumerId,
			kind: consumer.kind,
			energyKwh: take,
			source,
			constraintIds: [],
			reasonCodes: [],
			maxPowerW: consumer.maxPowerW,
			deadlineMs: consumer.deadlineMs,
			mandatory: consumer.mandatory,
			conservativeGrid,
		};
		base.reasonCodes = reasonCodesForCandidate(input, base, state, wbPresenceCodes);
		base.constraintIds = constraintIdsForCandidate(base);
		if (consumer.kind === "immersion_heater" && consumer.thermalBeforeDeadline) {
			if (slot.startMs < consumer.deadlineMs) {
				base.constraintIds = ["thermal.flex", "thermal.deadline"];
			}
		}
		out.push(base);
	}

	return out;
}

/** @returns true wenn Energie tatsächlich verbucht wurde. */
function applyCandidate(
	state: AllocationState,
	candidate: AllocationCandidate,
	allocations: UnifiedAllocationCell[],
): boolean {
	const slot = state.slots[candidate.slotIdx]!;
	const consumer = state.consumers.find((c) => c.consumerId === candidate.consumerId);
	if (!consumer) return false;

	const already = allocatedInSlotKwh(allocations, candidate.consumerId, slot.startIso);
	let e = candidate.energyKwh;
	if (candidate.maxPowerW !== null && candidate.maxPowerW > 0) {
		e = Math.min(e, Math.max(0, energyFromPowerW(candidate.maxPowerW) - already));
	}
	e = Math.min(e, consumer.remainingKwh);
	if (e <= EPS) return false;

	if (
		consumer.minPowerW &&
		consumer.minPowerW > 0 &&
		already <= EPS &&
		e + EPS < energyFromPowerW(consumer.minPowerW)
	) {
		return false;
	}

	if (candidate.source === "pv_surplus") {
		e = takePv(slot, e);
	} else if (candidate.source === "battery") {
		const draw = e / Math.max(state.dischargeEff, 0.1);
		const floor = dischargeFloorKwh(state, candidate.slotIdx);
		const socAt = projectedSocAt(state, candidate.slotIdx);
		if (socAt - draw < floor - EPS) return false;
		state.socDeltaBySlot[candidate.slotIdx] =
			(state.socDeltaBySlot[candidate.slotIdx] ?? 0) - draw;
		syncFinalSoc(state);
	}

	if (e <= EPS) return false;
	if (
		consumer.minPowerW &&
		consumer.minPowerW > 0 &&
		already <= EPS &&
		e + EPS < energyFromPowerW(consumer.minPowerW)
	) {
		if (candidate.source === "pv_surplus") slot.remainPvKwh += e;
		return false;
	}

	const booked = pushAlloc(
		allocations,
		slot,
		candidate.consumerId,
		candidate.kind,
		e,
		candidate.source,
		candidate.constraintIds,
		candidate.reasonCodes,
		candidate.maxPowerW,
	);
	if (booked <= EPS) {
		if (candidate.source === "pv_surplus") slot.remainPvKwh += e;
		return false;
	}
	if (booked + EPS < e && candidate.source === "pv_surplus") {
		slot.remainPvKwh += e - booked;
	}
	e = booked;

	if (candidate.kind === "battery_charge") {
		const stored = e * state.chargeEff;
		const socBefore = projectedSocAt(state, candidate.slotIdx);
		const room = Math.max(0, state.capacityKwh - socBefore);
		const storedClamped = Math.min(stored, room);
		state.socDeltaBySlot[candidate.slotIdx] =
			(state.socDeltaBySlot[candidate.slotIdx] ?? 0) + storedClamped;
		syncFinalSoc(state);
	}

	consumer.remainingKwh = Math.max(0, consumer.remainingKwh - e);
	dropSubMinRemainder([consumer]);
	return true;
}

function buildGoals(
	input: UnifiedDayPlannerInput,
	state: AllocationState,
	reasonCodes: string[],
): UnifiedGoalStatus[] {
	const goals: UnifiedGoalStatus[] = [];
	const wb = input.wallbox;
	if (wb) {
		const wc = state.consumers.find((c) => c.consumerId === "wallbox");
		const need = resolveVehicleNeedKwh(input);
		if (need === null || need <= EPS) {
			goals.push({
				consumerId: "wallbox",
				goalId: "energy",
				met: true,
				detailDe: "Kein Fahrzeug-Energiebedarf.",
			});
		} else {
			const feasibility = evaluateVehicleGoalFeasibility(input);
			for (const c of feasibility.reasonCodes) reasonCodes.push(c);
			const remaining = wc?.remainingKwh ?? need * (wb.chargeLossFactor ?? 1);
			const met: boolean | null =
				feasibility.status === "unreachable"
					? false
					: feasibility.status === "at_risk" || feasibility.status === "at_risk_unknown"
						? null
						: remaining <= 0.05;
			goals.push({
				consumerId: "wallbox",
				goalId: "energy_deadline",
				met,
				detailDe:
					feasibility.status === "unreachable"
						? `Fahrzeugziel physisch unerreichbar (max ~${feasibility.maxFeasibleEnergyKwh.toFixed(2)} kWh).`
						: feasibility.status === "at_risk_unknown"
							? "Fahrzeugziel unsicher wegen unknown Presence."
							: feasibility.status === "at_risk"
								? "Fahrzeugziel abhängig von predicted Presence."
								: remaining <= 0.05
									? "Fahrzeugziel im Plan gedeckt."
									: `Fahrzeugziel unvollständig, Rest ~${remaining.toFixed(2)} kWh.`,
			});
		}
	}

	const th = input.thermal;
	if (th) {
		const tc = state.consumers.find((c) => c.consumerId === "immersion_heater");
		if (th.headroomEnergyKwh === null || th.headroomEnergyKwh <= EPS) {
			goals.push({
				consumerId: "immersion_heater",
				goalId: "thermal_day",
				met: true,
				detailDe: "Kein thermischer Headroom.",
			});
		} else {
			const remaining = tc?.remainingKwh ?? th.headroomEnergyKwh;
			const hasDeadline = th.deadlineIso !== null;
			goals.push({
				consumerId: "immersion_heater",
				goalId: "thermal_day",
				met: remaining <= th.headroomEnergyKwh * 0.15,
				detailDe:
					remaining <= EPS
						? hasDeadline
							? `Thermisches Vorladen vor ${th.deadlineIso} aus PV geplant.`
							: "Thermischer Headroom aus PV geplant."
						: `Thermisch Rest ~${remaining.toFixed(2)} kWh (PV knapp — Batterie-Flex nur oberhalb Reserve-Floor).`,
			});
		}
	}

	return goals;
}

function rebuildPvActiveIndices(slots: SlotWork[]): number[] {
	const out: number[] = [];
	for (let i = 0; i < slots.length; i++) {
		if (slots[i]!.remainPvKwh > EPS) out.push(i);
	}
	return out;
}

/** Max. PV-Slots pro Consumer/Iteration (Beam) — hält CPU niedrig. */
const PV_BEAM = 20;

/**
 * Slot-Shortlist pro Consumer — kein voller Horizon-Scan jede Iteration.
 * PV: Top-Beam. Grid: ein bester Slot (Preis bzw. Frühe).
 */
function slotIndicesForConsumer(
	consumer: ConsumerState,
	state: AllocationState,
	pvActive: number[],
	allocations: UnifiedAllocationCell[],
): number[] {
	const slots = state.slots;
	const out: number[] = [];
	const seen = new Set<number>();

	const push = (si: number): void => {
		if (seen.has(si)) return;
		seen.add(si);
		out.push(si);
	};

	const pvRanked: { si: number; h: number }[] = [];
	for (const si of pvActive) {
		const slot = slots[si]!;
		if (slot.startMs >= consumer.deadlineMs) continue;
		if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso)) continue;
		let h = slot.remainPvKwh;
		if (consumer.kind === "climate" && consumer.mandatory) {
			h += Math.max(0, 2 - (slot.startMs - state.nowMs) / 3600_000);
		} else if (consumer.thermalBeforeDeadline && slot.startMs < consumer.deadlineMs) {
			h *= 1.25;
		}
		pvRanked.push({ si, h });
	}
	pvRanked.sort((a, b) => b.h - a.h || a.si - b.si);
	for (let i = 0; i < Math.min(PV_BEAM, pvRanked.length); i++) {
		push(pvRanked[i]!.si);
	}

	if (consumer.kind === "immersion_heater") {
		/*
		 * Alle PV-Slots vor Deadline in die Shortlist (Peak-Beam allein reicht nicht).
		 * Auswahl bleibt kontinuierlich über Score/Pressure — keine pressure≥X-Schwelle.
		 */
		for (let si = 0; si < slots.length; si++) {
			const slot = slots[si]!;
			if (slot.startMs < state.nowMs - 60_000) continue;
			if (slot.startMs >= consumer.deadlineMs) break;
			if (slot.remainPvKwh > EPS) push(si);
		}
		// Zusätzlich Batterie-Slots ohne PV, wenn Reserve-Floor Freiraum lässt.
		if (consumer.batteryEligible && projectedSocAt(state, 0) > floorKwhAt(state, 0) + EPS) {
			let added = 0;
			for (let si = 0; si < slots.length && added < 10; si++) {
				const slot = slots[si]!;
				if (slot.startMs >= consumer.deadlineMs) continue;
				if (slot.startMs < state.nowMs - 60_000) continue;
				if (slot.remainPvKwh > EPS) continue; // PV-Slots bereits via Beam
				push(si);
				added++;
			}
		}
		return out;
	}

	if (consumer.gridEligible) {
		let bestSi: number | null = null;
		let bestKey = Number.POSITIVE_INFINITY;
		for (let si = 0; si < slots.length; si++) {
			const slot = slots[si]!;
			if (slot.startMs >= consumer.deadlineMs) continue;
			if (!slot.gridAllowed || slot.importCt === null) continue;
			if (consumer.slotAllowed && !consumer.slotAllowed(slot.startIso)) continue;
			if (consumer.maxPowerW !== null && consumer.maxPowerW > 0) {
				const already = allocatedInSlotKwh(allocations, consumer.consumerId, slot.startIso);
				if (already + EPS >= energyFromPowerW(consumer.maxPowerW)) continue;
			}
			const key =
				consumer.kind === "climate" && consumer.mandatory
					? si
					: slot.importCt * 1000 + si * 0.001;
			if (key < bestKey) {
				bestKey = key;
				bestSi = si;
			}
		}
		if (bestSi !== null) push(bestSi);
	}

	if (consumer.batteryEligible && projectedSocAt(state, 0) > floorKwhAt(state, 0) + EPS) {
		let added = 0;
		for (let si = 0; si < slots.length && added < 8; si++) {
			const slot = slots[si]!;
			if (slot.startMs >= consumer.deadlineMs) continue;
			if (slot.startMs < state.nowMs - 60_000) continue;
			const socAt = projectedSocAt(state, si);
			if (usableBatteryEnergyKwh(socAt, floorKwhAt(state, si), state.dischargeEff) <= EPS) {
				continue;
			}
			push(si);
			added++;
		}
	}

	return out;
}

type ScoredPick = { candidate: AllocationCandidate; score: number };

function pickBestCandidate(
	input: UnifiedDayPlannerInput,
	state: AllocationState,
	weights: UnifiedOptimizeWeights,
	pvActive: number[],
	allocations: UnifiedAllocationCell[],
	wbPresenceCodes: string[],
	blocked: Set<string>,
	onlyConsumerId: string | null,
): ScoredPick | null {
	let best: AllocationCandidate | null = null;
	let bestScore = weights.minScoreThreshold;

	for (const consumer of state.consumers) {
		if (onlyConsumerId && consumer.consumerId !== onlyConsumerId) continue;
		if (consumer.remainingKwh <= EPS) continue;
		const slotIndices = slotIndicesForConsumer(consumer, state, pvActive, allocations);
		for (const si of slotIndices) {
			const candidates = generateCandidatesForConsumer(
				input,
				state,
				consumer,
				si,
				wbPresenceCodes,
				allocations,
				weights,
			);
			for (const cand of candidates) {
				const key = `${cand.consumerId}|${cand.slotIdx}|${cand.source}`;
				if (blocked.has(key)) continue;
				const sc = scoreCandidate(input, state, cand, weights);
				if (sc > bestScore + EPS) {
					bestScore = sc;
					best = cand;
				} else if (Math.abs(sc - bestScore) <= EPS && best) {
					const tie =
						cand.slotIdx - best.slotIdx ||
						cand.consumerId.localeCompare(best.consumerId) ||
						cand.source.localeCompare(best.source);
					if (tie < 0) {
						best = cand;
						bestScore = sc;
					}
				}
			}
		}
	}
	return best ? { candidate: best, score: bestScore } : null;
}

export function runScoreBasedAllocation(
	input: UnifiedDayPlannerInput,
	slots: SlotWork[],
	opts?: {
		initialSocKwh?: number;
		reserveKwh?: number;
		reasonCodes?: string[];
	},
): ScoreAllocationResult {
	const weights = optimizeWeightsFromInput(input);
	const allocations: UnifiedAllocationCell[] = [];
	const reasonCodes: string[] = opts?.reasonCodes ? [...opts.reasonCodes] : [];

	const bat = input.battery;
	const capacity = bat.usableCapacityKwh ?? 0;
	const socPct = bat.socPct;
	const batteryKnown = capacity > 0 && socPct !== null;
	const policy = plannerModePolicyFromGlobalMode(input.globalMode);
	const endSocPct =
		bat.endSocTargetPct != null && Number.isFinite(bat.endSocTargetPct)
			? bat.endSocTargetPct
			: policy.chargeTargetSocPct;
	const targetKwh = batteryKnown ? capacity * (endSocPct / 100) : 0;
	const chargeEff = bat.chargeEfficiency ?? 1;
	const dischargeEff = bat.dischargeEfficiency ?? 1;

	const wb = input.wallbox;
	const wbPresenceCodes = wb ? collectPresenceReasonCodes(wb.presenceWindows) : [];
	if (wb) {
		for (const c of wbPresenceCodes) reasonCodes.push(c);
	}

	const th = input.thermal;
	if (th?.emptyAtSource === "estimated") reasonCodes.push(REASON.THERMAL_EMPTY_AT_ESTIMATED);
	if (th?.deadlineIso) reasonCodes.push(REASON.THERMAL_DEADLINE_PV_WINDOW);

	/** Reserve: freier Surplus nach Pflichtbindung. next-PV: Fenster roh, Check gebunden. */
	const hardBound = hardPvBoundForPlanning(input, slots);
	const reserveFloor = buildBatteryReserveFloor(input, applyHardPvBoundsToSlots(slots, hardBound));
	const nowMsPlan = Date.parse(input.time.nowIso);
	const fromIdxPlan = Math.max(
		0,
		slots.findIndex((s) => s.startMs + 15 * 60_000 > nowMsPlan),
	);
	const nextPvPlan = findNextReliablePvAfterCurrentWindow(
		slots,
		fromIdxPlan,
		pvConfidenceFactor(input),
		nowMsPlan,
		hardBound,
	);
	const modeDischargeMinKwh =
		weights.batteryMinSocForDeficitPct < 99 && capacity > 0
			? capacity * (weights.batteryMinSocForDeficitPct / 100)
			: 0;
	const initialSocKwh = opts?.initialSocKwh ?? (batteryKnown ? (socPct! / 100) * capacity : 0);
	const state: AllocationState = {
		slots,
		socKwh: initialSocKwh,
		initialSocKwh,
		socDeltaBySlot: slots.map(() => 0),
		capacityKwh: capacity,
		reserveKwh: opts?.reserveKwh ?? 0,
		reserveFloor,
		batteryTargetKwh: targetKwh,
		chargeEff,
		dischargeEff,
		consumers: buildConsumerStates(input, slots),
		nowMs: nowMsPlan,
		batteryHold: wb ? wallboxImmediate(wb) : false,
		dischargeLiveSupported: bat.dischargeLiveSupported,
		passiveBatteryEnergyAvailable: bat.passiveBatteryEnergyAvailable === true,
		pvConfidence: pvConfidenceFactor(input),
		modePolicy: policy,
		modeDischargeMinKwh,
		nextReliablePvMs: nextPvPlan.startMs,
	};

	if (!weights.allowOptimization) {
		return {
			allocations,
			goals: buildGoals(input, state, reasonCodes),
			reasonCodes,
			finalSocKwh: state.socKwh,
		};
	}

	dropSubMinRemainder(state.consumers);
	const totalNeedAc = state.consumers.reduce((a, c) => a + c.remainingKwh, 0);
	const minChunk = 0.05;
	const maxIter = Math.min(2500, Math.ceil(totalNeedAc / minChunk) + slots.length * 4);
	const blocked = new Set<string>();
	let stagnant = 0;

	/** Nur Slots mit Rest-PV — vermeidet O(Horizon) Vollscans (CPU). */
	let pvActive = rebuildPvActiveIndices(slots);

	const touchPv = (si: number, before: number): void => {
		const after = state.slots[si]?.remainPvKwh ?? 0;
		if (before > EPS && after <= EPS) {
			pvActive = pvActive.filter((i) => i !== si);
		}
	};

	for (let iter = 0; iter < maxIter; ) {
		const pick = pickBestCandidate(
			input,
			state,
			weights,
			pvActive,
			allocations,
			wbPresenceCodes,
			blocked,
			null,
		);
		if (!pick) break;

		const appliedSi = pick.candidate.slotIdx;
		const pvBefore = state.slots[appliedSi]?.remainPvKwh ?? 0;
		const applied = applyCandidate(state, pick.candidate, allocations);
		iter++;
		if (!applied) {
			blocked.add(
				`${pick.candidate.consumerId}|${pick.candidate.slotIdx}|${pick.candidate.source}`,
			);
			stagnant++;
			if (stagnant >= 64) break;
			continue;
		}
		stagnant = 0;
		touchPv(appliedSi, pvBefore);

		/**
		 * Local-Fill: denselben Consumer weiter bedienen ohne globalen Rescan.
		 * Deutlich weniger CPU bei großen Fahrzeug-/Thermal-Bedarfen.
		 */
		const focusId = pick.candidate.consumerId;
		for (let burst = 0; burst < 12 && iter < maxIter; burst++) {
			const local = pickBestCandidate(
				input,
				state,
				weights,
				pvActive,
				allocations,
				wbPresenceCodes,
				blocked,
				focusId,
			);
			if (!local || local.score < weights.minScoreThreshold) break;
			const si = local.candidate.slotIdx;
			const before = state.slots[si]?.remainPvKwh ?? 0;
			const ok = applyCandidate(state, local.candidate, allocations);
			iter++;
			if (!ok) {
				blocked.add(
					`${local.candidate.consumerId}|${local.candidate.slotIdx}|${local.candidate.source}`,
				);
				break;
			}
			touchPv(si, before);
		}
	}

	if (batteryKnown && state.socKwh + EPS >= state.reserveKwh && (opts?.reserveKwh ?? 0) > EPS) {
		reasonCodes.push(REASON.BATTERY_RESERVE_PROTECTED);
	}
	const nowFloor = floorKwhAt(state, 0);
	if (batteryKnown && usableBatteryEnergyKwh(state.socKwh, nowFloor, state.dischargeEff) > 0.25) {
		reasonCodes.push(REASON.BATTERY_FLEX_USABLE);
	}
	if (
		allocations.some(
			(a) =>
				a.energySource === "battery" ||
				(a.energySource === "mixed" && a.kind !== "battery_charge"),
		)
	) {
		reasonCodes.push(REASON.BATTERY_FROM_RESERVE_FLEX);
	}

	const goals = buildGoals(input, state, reasonCodes);

	return {
		allocations,
		goals,
		reasonCodes,
		finalSocKwh: state.socKwh,
	};
}
