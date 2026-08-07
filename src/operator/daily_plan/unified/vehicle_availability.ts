/**
 * Future Vehicle Presence — Windows + Zielerreichbarkeit.
 * Priorität: live > explicit > predicted > unknown.
 */

import {
	predictAt,
	type VehiclePresenceLearningStore,
} from "../../../learning/vehicle_presence";
import { REASON } from "./reason_codes";
import type {
	UnifiedDayPlannerInput,
	UnifiedVehicleAvailabilitySource,
	UnifiedVehicleAvailabilityStatus,
	UnifiedVehiclePresenceWindow,
	UnifiedWallboxInput,
} from "./types";

const SLOT_H = 0.25;
const EPS = 1e-6;

export function normalizePresenceWindow(
	w: UnifiedVehiclePresenceWindow,
): Required<
	Pick<
		UnifiedVehiclePresenceWindow,
		"available" | "startIso" | "endIso" | "status" | "source" | "confidencePct" | "hard"
	>
> {
	const status: UnifiedVehicleAvailabilityStatus =
		w.status ?? (w.available ? "available" : "unavailable");
	const source: UnifiedVehicleAvailabilitySource = w.source ?? "explicit";
	const hard = w.hard ?? (source === "live_connected" || source === "live_disconnected" || source === "explicit");
	return {
		available: status === "available",
		startIso: w.startIso,
		endIso: w.endIso,
		status,
		source,
		confidencePct: w.confidencePct ?? (hard ? 100 : null),
		hard,
	};
}

function inWindow(iso: string, startIso: string, endIso: string): boolean {
	const t = Date.parse(iso);
	return t >= Date.parse(startIso) && t < Date.parse(endIso);
}

export type ExplicitPresenceWindow = {
	available: boolean;
	startIso: string;
	endIso: string;
};

export type BuildVehicleAvailabilityArgs = {
	nowIso: string;
	timezone: string;
	slots: Array<{ startIso: string; endIso: string }>;
	connectedNow: boolean;
	/** Explizite Benutzer-/Plan-Fenster (schlagen Learning). */
	explicitWindows?: ExplicitPresenceWindow[] | null;
	learningStore?: VehiclePresenceLearningStore | null;
	/** Sichere Fahrzeugprofil-ID (wb_vehicle_map); ohne ID kein predicted Learning. */
	learningVehicleKey?: string | null;
	observedAtIso?: string | null;
};

function findExplicit(
	explicit: ExplicitPresenceWindow[] | null | undefined,
	slotStartIso: string,
): ExplicitPresenceWindow | null {
	if (!explicit?.length) return null;
	for (const w of explicit) {
		if (inWindow(slotStartIso, w.startIso, w.endIso)) return w;
	}
	return null;
}

function mergeWindows(windows: UnifiedVehiclePresenceWindow[]): UnifiedVehiclePresenceWindow[] {
	if (windows.length === 0) return [];
	const sorted = [...windows].sort((a, b) => a.startIso.localeCompare(b.startIso));
	const out: UnifiedVehiclePresenceWindow[] = [];
	let cur = { ...sorted[0]! };
	for (const next of sorted.slice(1)) {
		const same =
			normalizePresenceWindow(cur).status === normalizePresenceWindow(next).status &&
			normalizePresenceWindow(cur).source === normalizePresenceWindow(next).source &&
			normalizePresenceWindow(cur).hard === normalizePresenceWindow(next).hard &&
			cur.endIso === next.startIso;
		if (same) {
			cur = { ...cur, endIso: next.endIso };
		} else {
			out.push(cur);
			cur = { ...next };
		}
	}
	out.push(cur);
	return out;
}

/**
 * Baut Presence-Fenster für den Planungshorizont (nicht auf einen Kalendertag genagelt).
 */
export function buildVehicleAvailabilityWindows(
	args: BuildVehicleAvailabilityArgs,
): UnifiedVehiclePresenceWindow[] {
	const nowMs = Date.parse(args.nowIso);
	const windows: UnifiedVehiclePresenceWindow[] = [];

	for (const slot of args.slots) {
		const startMs = Date.parse(slot.startIso);
		const endMs = Date.parse(slot.endIso);
		const isCurrent = Number.isFinite(nowMs) && nowMs >= startMs && nowMs < endMs;

		if (isCurrent) {
			if (args.connectedNow) {
				windows.push({
					available: true,
					startIso: slot.startIso,
					endIso: slot.endIso,
					status: "available",
					source: "live_connected",
					confidencePct: 100,
					hard: true,
				});
			} else {
				windows.push({
					available: false,
					startIso: slot.startIso,
					endIso: slot.endIso,
					status: "unavailable",
					source: "live_disconnected",
					confidencePct: 100,
					hard: true,
				});
			}
			continue;
		}

		const explicit = findExplicit(args.explicitWindows, slot.startIso);
		if (explicit) {
			windows.push({
				available: explicit.available,
				startIso: slot.startIso,
				endIso: slot.endIso,
				status: explicit.available ? "available" : "unavailable",
				source: "explicit",
				confidencePct: 100,
				hard: true,
			});
			continue;
		}

		const pred = predictAt(
			args.learningStore,
			startMs,
			args.timezone,
			args.learningVehicleKey ?? null,
		);
		if (pred.status === "available" || pred.status === "unavailable") {
			windows.push({
				available: pred.status === "available",
				startIso: slot.startIso,
				endIso: slot.endIso,
				status: pred.status,
				source: "predicted",
				confidencePct: pred.confidencePct,
				hard: false,
			});
			continue;
		}

		windows.push({
			available: false,
			startIso: slot.startIso,
			endIso: slot.endIso,
			status: "unknown",
			source: "unknown",
			confidencePct: null,
			hard: false,
		});
	}

	return mergeWindows(windows);
}

export function presenceDigest(windows: UnifiedVehiclePresenceWindow[]): string {
	return JSON.stringify(
		windows.map((w) => {
			const n = normalizePresenceWindow(w);
			return {
				s: n.startIso,
				e: n.endIso,
				st: n.status,
				src: n.source,
				h: n.hard,
				c: n.confidencePct === null ? null : Math.round(n.confidencePct / 5) * 5,
			};
		}),
	);
}

export type VehicleGoalFeasibility = {
	needKwh: number | null;
	maxFeasibleEnergyKwh: number;
	maxFeasibleHardEnergyKwh: number;
	maxFeasiblePredictedEnergyKwh: number;
	availableChargeHours: number;
	hardAvailableChargeHours: number;
	/** reachable | at_risk | unreachable | at_risk_unknown | no_need */
	status: "reachable" | "at_risk" | "unreachable" | "at_risk_unknown" | "no_need";
	reasonCodes: string[];
};

function energyFromPowerW(powerW: number): number {
	return (powerW / 1000) * SLOT_H;
}

function resolveNeedKwh(wb: UnifiedWallboxInput): number | null {
	if (wb.requiredEnergyKwh !== null && wb.requiredEnergyKwh > 0) return wb.requiredEnergyKwh;
	if (wb.targetSocPct !== null && wb.vehicleSocPct !== null && wb.vehicleCapacityKwh !== null) {
		return (Math.max(0, wb.targetSocPct - wb.vehicleSocPct) / 100) * wb.vehicleCapacityKwh;
	}
	return wb.fallbackEnergyNeedKwh;
}

function windowForSlot(
	windows: UnifiedVehiclePresenceWindow[],
	slotStartIso: string,
): ReturnType<typeof normalizePresenceWindow> | null {
	for (const w of windows) {
		if (inWindow(slotStartIso, w.startIso, w.endIso)) return normalizePresenceWindow(w);
	}
	return null;
}

/**
 * Physisch machbare Energie bis Deadline in allocatable (available) Slots.
 */
export function evaluateVehicleGoalFeasibility(
	input: UnifiedDayPlannerInput,
	opts?: { nowMs?: number },
): VehicleGoalFeasibility {
	const wb = input.wallbox;
	const empty: VehicleGoalFeasibility = {
		needKwh: null,
		maxFeasibleEnergyKwh: 0,
		maxFeasibleHardEnergyKwh: 0,
		maxFeasiblePredictedEnergyKwh: 0,
		availableChargeHours: 0,
		hardAvailableChargeHours: 0,
		status: "no_need",
		reasonCodes: [],
	};
	if (!wb) return empty;

	const needRaw = resolveNeedKwh(wb);
	const loss = wb.chargeLossFactor ?? 1;
	const needKwh = needRaw === null ? null : needRaw * loss;
	const maxW = wb.maxChargePowerW;
	const slotCap = maxW !== null && maxW > 0 ? energyFromPowerW(maxW) : null;

	const deadlineMs = wb.deadlineIso ? Date.parse(wb.deadlineIso) : Number.POSITIVE_INFINITY;
	const nowMs = opts?.nowMs ?? Date.parse(input.time.nowIso);

	let maxAll = 0;
	let maxHard = 0;
	let maxPred = 0;
	let hoursAll = 0;
	let hoursHard = 0;
	let unknownHoursBeforeDeadline = 0;

	for (const s of input.time.slots) {
		const start = Date.parse(s.startIso);
		const end = Date.parse(s.endIso);
		if (!(start < deadlineMs)) continue;
		if (!(end > nowMs)) continue;

		const w = windowForSlot(wb.presenceWindows, s.startIso);
		const status = w?.status ?? "unknown";

		if (status === "available") {
			// Ohne maxChargePowerW: keine Schönrechnung erfundener Leistung
			const add = slotCap !== null ? slotCap : 0;
			maxAll += add;
			hoursAll += SLOT_H;
			if (w?.hard === true || w?.source === "live_connected" || w?.source === "explicit") {
				maxHard += add;
				hoursHard += SLOT_H;
			} else if (w?.source === "predicted") {
				maxPred += add;
			}
		} else if (status === "unknown") {
			unknownHoursBeforeDeadline += SLOT_H;
		}
	}

	const reasonCodes: string[] = [];
	if (wb.connectedNow) reasonCodes.push(REASON.VEHICLE_AVAILABLE_NOW);
	else reasonCodes.push(REASON.VEHICLE_UNAVAILABLE_NOW);

	if (needKwh === null || needKwh <= EPS) {
		return {
			...empty,
			needKwh,
			maxFeasibleEnergyKwh: round3(maxAll),
			maxFeasibleHardEnergyKwh: round3(maxHard),
			maxFeasiblePredictedEnergyKwh: round3(maxPred),
			availableChargeHours: hoursAll,
			hardAvailableChargeHours: hoursHard,
			reasonCodes: [...reasonCodes, REASON.VEHICLE_GOAL_REACHABLE],
		};
	}

	if (maxAll + EPS < needKwh) {
		reasonCodes.push(REASON.VEHICLE_GOAL_UNREACHABLE);
		return {
			needKwh,
			maxFeasibleEnergyKwh: round3(maxAll),
			maxFeasibleHardEnergyKwh: round3(maxHard),
			maxFeasiblePredictedEnergyKwh: round3(maxPred),
			availableChargeHours: hoursAll,
			hardAvailableChargeHours: hoursHard,
			status: "unreachable",
			reasonCodes,
		};
	}

	if (maxHard + EPS >= needKwh) {
		reasonCodes.push(REASON.VEHICLE_GOAL_REACHABLE);
		return {
			needKwh,
			maxFeasibleEnergyKwh: round3(maxAll),
			maxFeasibleHardEnergyKwh: round3(maxHard),
			maxFeasiblePredictedEnergyKwh: round3(maxPred),
			availableChargeHours: hoursAll,
			hardAvailableChargeHours: hoursHard,
			status: "reachable",
			reasonCodes,
		};
	}

	// Braucht predicted und/oder unknown
	if (unknownHoursBeforeDeadline > EPS && maxHard + maxPred + EPS < needKwh) {
		reasonCodes.push(REASON.VEHICLE_GOAL_AT_RISK_DUE_TO_UNKNOWN_AVAILABILITY);
		reasonCodes.push(REASON.VEHICLE_PRESENCE_UNKNOWN);
		return {
			needKwh,
			maxFeasibleEnergyKwh: round3(maxAll),
			maxFeasibleHardEnergyKwh: round3(maxHard),
			maxFeasiblePredictedEnergyKwh: round3(maxPred),
			availableChargeHours: hoursAll,
			hardAvailableChargeHours: hoursHard,
			status: "at_risk_unknown",
			reasonCodes,
		};
	}

	if (maxHard + maxPred + EPS >= needKwh && maxHard + EPS < needKwh) {
		reasonCodes.push(REASON.VEHICLE_GOAL_AT_RISK);
		reasonCodes.push(REASON.VEHICLE_PRESENCE_PREDICTED_AVAILABLE);
		return {
			needKwh,
			maxFeasibleEnergyKwh: round3(maxAll),
			maxFeasibleHardEnergyKwh: round3(maxHard),
			maxFeasiblePredictedEnergyKwh: round3(maxPred),
			availableChargeHours: hoursAll,
			hardAvailableChargeHours: hoursHard,
			status: "at_risk",
			reasonCodes,
		};
	}

	// Theoretisch genug available, aber Erreichbarkeit hängt an unknown (nicht als available gezählt)
	if (unknownHoursBeforeDeadline > EPS) {
		reasonCodes.push(REASON.VEHICLE_GOAL_AT_RISK_DUE_TO_UNKNOWN_AVAILABILITY);
		return {
			needKwh,
			maxFeasibleEnergyKwh: round3(maxAll),
			maxFeasibleHardEnergyKwh: round3(maxHard),
			maxFeasiblePredictedEnergyKwh: round3(maxPred),
			availableChargeHours: hoursAll,
			hardAvailableChargeHours: hoursHard,
			status: "at_risk_unknown",
			reasonCodes,
		};
	}

	reasonCodes.push(REASON.VEHICLE_GOAL_AT_RISK);
	return {
		needKwh,
		maxFeasibleEnergyKwh: round3(maxAll),
		maxFeasibleHardEnergyKwh: round3(maxHard),
		maxFeasiblePredictedEnergyKwh: round3(maxPred),
		availableChargeHours: hoursAll,
		hardAvailableChargeHours: hoursHard,
		status: "at_risk",
		reasonCodes,
	};
}

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/** Slot darf Fahrzeug-Allocation erhalten (nur status=available). */
export function vehicleSlotAllocatable(
	wb: UnifiedWallboxInput,
	slotStartIso: string,
): boolean {
	if (!wb.presenceHardConstraint) {
		return wb.connectedNow;
	}
	for (const w of wb.presenceWindows) {
		if (!inWindow(slotStartIso, w.startIso, w.endIso)) continue;
		return normalizePresenceWindow(w).status === "available";
	}
	return false;
}

export function collectPresenceReasonCodes(windows: UnifiedVehiclePresenceWindow[]): string[] {
	const codes = new Set<string>();
	for (const w of windows) {
		const n = normalizePresenceWindow(w);
		if (n.source === "live_connected") codes.add(REASON.VEHICLE_AVAILABLE_NOW);
		if (n.source === "live_disconnected") codes.add(REASON.VEHICLE_UNAVAILABLE_NOW);
		if (n.source === "explicit") codes.add(REASON.VEHICLE_PRESENCE_EXPLICIT);
		if (n.source === "predicted" && n.status === "available") {
			codes.add(REASON.VEHICLE_PRESENCE_PREDICTED_AVAILABLE);
		}
		if (n.source === "predicted" && n.status === "unavailable") {
			codes.add(REASON.VEHICLE_PRESENCE_PREDICTED_UNAVAILABLE);
		}
		if (n.status === "unknown") codes.add(REASON.VEHICLE_PRESENCE_UNKNOWN);
	}
	return [...codes];
}
