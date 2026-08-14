/**
 * EV energy classes for Unified (Phase 4).
 *
 * Units:
 * - vehicle usable kWh = capacity × ΔSOC/100
 * - required AC input kWh = usable / chargingEfficiency  (Phase 3)
 *   OR usable × chargeLossFactor (legacy Unified fixtures, typically 1.05)
 *
 * Never apply both. Tibber/external smart-charging minimum is never Hard.
 * No deadline → Hard = 0 (target energy remains Soft).
 */

import { energyForSocDeltaKwh, roundKwh } from "../../../addons/wallbox/ev_foundation/decision/energy";
import type {
	EvManagementMode,
	UnifiedAllocationCell,
	UnifiedEvPlannerDiagnosis,
	UnifiedEvReservation,
	UnifiedWallboxInput,
} from "./types";

export const EV_PLANNER_ROLE = "electric_vehicle" as const;
export type EvPlannerRole = typeof EV_PLANNER_ROLE;

export const WALLBOX_HARD_CONSUMER_ID = "wallbox";
export const WALLBOX_TARGET_CONSUMER_ID = "wallbox_target";

export type EvEnergyClasses = {
	/** AC input. 0 = no hard requirement (defined), never a fake unknown. */
	hardRequiredEnergyKwh: number;
	/** AC input to target SOC; null if unknown (missing SOC/capacity/efficiency). */
	targetEnergyKwh: number | null;
	/** max(0, target − hard); 0 if target unknown. */
	targetFlexEnergyKwh: number;
	energyUnit: "ac_input_kwh";
	energyGoalHard: boolean;
	/** True when target/hard could not be computed (SOC/capacity missing). */
	insufficientData: boolean;
};

export function toAcInputKwh(input: {
	usableKwh: number | null;
	chargingEfficiency: number | null;
	chargeLossFactor: number | null;
}): number | null {
	if (input.usableKwh == null || !Number.isFinite(input.usableKwh)) return null;
	if (input.chargingEfficiency != null && input.chargingEfficiency > 0) {
		return roundKwh(input.usableKwh / input.chargingEfficiency);
	}
	const loss = input.chargeLossFactor != null && input.chargeLossFactor > 0 ? input.chargeLossFactor : 1;
	return roundKwh(Math.max(0, input.usableKwh) * loss);
}

export function resolveEvEnergyClasses(wb: UnifiedWallboxInput): EvEnergyClasses {
	const preHard = wb.hardRequiredEnergyKwh;
	const preTarget = wb.targetEnergyKwh;

	let targetEnergyKwh =
		preTarget != null && Number.isFinite(preTarget)
			? roundKwh(Math.max(0, preTarget))
			: energyForSocDeltaKwh({
					vehicleSocPct: wb.vehicleSocPct,
					targetSocPct: wb.targetSocPct,
					batteryCapacityKWh: wb.vehicleCapacityKwh,
					chargingEfficiency: wb.chargingEfficiency ?? null,
				});
	if (targetEnergyKwh == null && wb.requiredEnergyKwh != null) {
		targetEnergyKwh = toAcInputKwh({
			usableKwh: wb.requiredEnergyKwh,
			chargingEfficiency: wb.chargingEfficiency ?? null,
			chargeLossFactor: wb.chargingEfficiency != null ? 1 : (wb.chargeLossFactor ?? 1),
		});
	}

	let hardRequiredEnergyKwh = 0;
	if (preHard != null && Number.isFinite(preHard)) {
		hardRequiredEnergyKwh = roundKwh(Math.max(0, preHard));
	} else if (
		wb.minimumDepartureSocPct != null &&
		wb.deadlineIso &&
		wb.vehicleSocPct != null &&
		wb.vehicleCapacityKwh != null
	) {
		const ac = energyForSocDeltaKwh({
			vehicleSocPct: wb.vehicleSocPct,
			targetSocPct: wb.minimumDepartureSocPct,
			batteryCapacityKWh: wb.vehicleCapacityKwh,
			chargingEfficiency: wb.chargingEfficiency ?? null,
		});
		if (ac != null) hardRequiredEnergyKwh = ac;
		else {
			const usable =
				(Math.max(0, wb.minimumDepartureSocPct - wb.vehicleSocPct) / 100) * wb.vehicleCapacityKwh;
			hardRequiredEnergyKwh =
				toAcInputKwh({
					usableKwh: usable,
					chargingEfficiency: null,
					chargeLossFactor: wb.chargeLossFactor ?? 1,
				}) ?? 0;
		}
	} else if (wb.energyGoalHard === true && wb.deadlineIso && wb.requiredEnergyKwh != null) {
		/* Legacy fixtures: explicit hard goal + deadline + requiredEnergy. */
		hardRequiredEnergyKwh =
			toAcInputKwh({
				usableKwh: wb.requiredEnergyKwh,
				chargingEfficiency: wb.chargingEfficiency ?? null,
				chargeLossFactor: wb.chargingEfficiency != null ? 1 : (wb.chargeLossFactor ?? 1),
			}) ?? 0;
	}

	const insufficientData =
		wb.vehicleSocPct == null &&
		preTarget == null &&
		preHard == null &&
		wb.requiredEnergyKwh == null &&
		wb.fallbackEnergyNeedKwh == null;

	if (insufficientData) {
		return {
			hardRequiredEnergyKwh: 0,
			targetEnergyKwh: null,
			targetFlexEnergyKwh: 0,
			energyUnit: "ac_input_kwh",
			energyGoalHard: false,
			insufficientData: true,
		};
	}

	/** Keine echte Deadline → keine Hard-Energie (auch wenn ein Pre-Wert gemappt wurde). */
	if (!wb.deadlineIso) {
		hardRequiredEnergyKwh = 0;
	}

	const targetFlexEnergyKwh =
		targetEnergyKwh == null ? 0 : roundKwh(Math.max(0, targetEnergyKwh - hardRequiredEnergyKwh));

	return {
		hardRequiredEnergyKwh,
		targetEnergyKwh,
		targetFlexEnergyKwh,
		energyUnit: "ac_input_kwh",
		energyGoalHard: hardRequiredEnergyKwh > 0 && Boolean(wb.deadlineIso),
		insufficientData: false,
	};
}

export function resolveEvManagementMode(input: {
	connectedNow: boolean;
	hasAllocatablePresence: boolean;
	externalAuthorityState?: string | null;
	takeoverSeverity?: string | null;
}): EvManagementMode {
	if (!input.connectedNow && !input.hasAllocatablePresence) return "unavailable";
	const sev = input.takeoverSeverity ?? "none";
	if (sev === "recommended" || sev === "required") return "takeover_candidate";
	const auth = input.externalAuthorityState ?? "";
	if (auth === "active" || auth === "planned" || auth === "active_without_plan") {
		if (sev === "none" || sev === "observe" || sev === "") return "externally_managed";
	}
	return "ems_candidate";
}

export function evManagementFromWallbox(wb: UnifiedWallboxInput | null | undefined): EvManagementMode {
	if (!wb) return "unavailable";
	if (wb.managementMode) return wb.managementMode;
	const hasPresence = wb.presenceWindows.some((w) => {
		const status = w.status ?? (w.available ? "available" : "unavailable");
		return status === "available";
	});
	return resolveEvManagementMode({
		connectedNow: wb.connectedNow,
		hasAllocatablePresence: hasPresence,
		externalAuthorityState: wb.externalAuthorityState,
		takeoverSeverity: wb.takeoverSeverity,
	});
}

/** EMS may allocate EV energy (still planning-only for new writes). */
export function evEmsAllocates(mode: EvManagementMode): boolean {
	return mode === "ems_candidate" || mode === "takeover_candidate";
}

/** Executable daily-plan wallbox slice — not for external/takeover-candidate. */
export function evDispatchWallboxEntries(mode: EvManagementMode): boolean {
	return mode === "ems_candidate";
}

export function overlapHours(a0: number, a1: number, b0: number, b1: number): number {
	const lo = Math.max(a0, b0);
	const hi = Math.min(a1, b1);
	if (!(hi > lo)) return 0;
	return (hi - lo) / 3_600_000;
}

function reservationQuality(raw: unknown): UnifiedEvReservation["quality"] {
	if (raw === "ok" || raw === "degraded" || raw === "unknown") return raw;
	return "unknown";
}

/** Neutral smart-plan slots → Unified reservations. Never vendor state IDs. */
export function parseExternalReservations(raw: unknown): UnifiedEvReservation[] {
	let list: unknown[] = [];
	if (typeof raw === "string" && raw.trim()) {
		try {
			const parsed = JSON.parse(raw) as unknown;
			if (Array.isArray(parsed)) list = parsed;
			else if (parsed && typeof parsed === "object" && Array.isArray((parsed as { slots?: unknown }).slots)) {
				list = (parsed as { slots: unknown[] }).slots;
			}
		} catch {
			return [];
		}
	} else if (Array.isArray(raw)) {
		list = raw;
	}
	const out: UnifiedEvReservation[] = [];
	for (const item of list) {
		if (!item || typeof item !== "object") continue;
		const o = item as Record<string, unknown>;
		const startIso = typeof o.startIso === "string" ? o.startIso : typeof o.start === "string" ? o.start : null;
		const endIso = typeof o.endIso === "string" ? o.endIso : typeof o.end === "string" ? o.end : null;
		if (!startIso || !endIso) continue;
		const powerRaw = o.powerW ?? o.plannedPowerW ?? (typeof o.plannedPowerKw === "number" ? o.plannedPowerKw * 1000 : null);
		const energyRaw = o.energyKwh ?? o.plannedEnergyKWh ?? o.plannedEnergyKwh;
		const powerW = typeof powerRaw === "number" && Number.isFinite(powerRaw) ? powerRaw : null;
		const energyKwh = typeof energyRaw === "number" && Number.isFinite(energyRaw) ? energyRaw : null;
		out.push({
			startIso,
			endIso,
			powerW,
			energyKwh,
			quality: reservationQuality(o.quality),
		});
	}
	return out;
}

export function totalEvAcNeedKwh(classes: EvEnergyClasses): number | null {
	if (classes.insufficientData) return null;
	if (classes.targetEnergyKwh == null && classes.hardRequiredEnergyKwh <= 0) return null;
	return roundKwh(classes.hardRequiredEnergyKwh + classes.targetFlexEnergyKwh);
}

export function buildEvPlannerDiagnosis(input: {
	wallbox: UnifiedWallboxInput | null | undefined;
	allocations: UnifiedAllocationCell[];
	slots: Array<{ startIso: string; importCt: number | null }>;
}): UnifiedEvPlannerDiagnosis | null {
	const wb = input.wallbox;
	if (!wb) return null;
	const classes = resolveEvEnergyClasses(wb);
	const mode = evManagementFromWallbox(wb);
	const wbAlloc = input.allocations.filter((a) => a.kind === "wallbox");
	let pv = 0;
	let grid = 0;
	let costCt = 0;
	let priced = 0;
	let first: string | null = null;
	let last: string | null = null;
	const planSlots: Array<Record<string, unknown>> = [];
	for (const a of wbAlloc) {
		if (a.energySource === "pv_surplus") pv += a.allocatedEnergyKwh;
		if (a.energySource === "grid" || a.energySource === "mixed") grid += a.allocatedEnergyKwh;
		const slot = input.slots.find((s) => s.startIso === a.slot.startIso);
		if ((a.energySource === "grid" || a.energySource === "mixed") && slot?.importCt != null) {
			costCt += a.allocatedEnergyKwh * slot.importCt;
			priced += a.allocatedEnergyKwh;
		}
		if (!first || a.slot.startIso < first) first = a.slot.startIso;
		if (!last || a.slot.endIso > last) last = a.slot.endIso;
		planSlots.push({
			startIso: a.slot.startIso,
			endIso: a.slot.endIso,
			energyKwh: a.allocatedEnergyKwh,
			source: a.energySource,
			consumerId: a.consumerId,
			reasonCodes: a.reasonCodes,
		});
	}
	const planned = roundKwh(pv + grid);
	const acNeed = totalEvAcNeedKwh(classes);
	const unplanned =
		mode === "externally_managed"
			? null
			: acNeed == null
				? null
				: roundKwh(Math.max(0, acNeed - planned));
	const participating =
		mode !== "unavailable" &&
		(planned > 0 ||
			(wb.externalReservations?.length ?? 0) > 0 ||
			(classes.hardRequiredEnergyKwh > 0 || (classes.targetEnergyKwh ?? 0) > 0));
	let planQuality: UnifiedEvPlannerDiagnosis["planQuality"] = "ok";
	if (wb.externalPlanQuality === "degraded" || wb.uncertainty.status === "degraded") planQuality = "degraded";
	if (classes.insufficientData || wb.socSource === "unknown" || wb.externalPlanQuality === "unknown") {
		planQuality = planQuality === "ok" ? "unknown" : planQuality;
	}
	const reservations = (wb.externalReservations ?? []).map((r) => ({
		startIso: r.startIso,
		endIso: r.endIso,
		powerW: r.powerW,
		energyKwh: r.energyKwh,
		quality: r.quality,
		kind: "external_reservation",
	}));
	return {
		participating,
		role: EV_PLANNER_ROLE,
		managementMode: mode,
		hardEnergyKwh: classes.hardRequiredEnergyKwh,
		targetEnergyKwh: classes.targetEnergyKwh,
		acEnergyRequiredKwh: acNeed,
		plannedEnergyKwh: planned,
		unplannedEnergyKwh: unplanned,
		plannedCostEur: grid <= 0 ? 0 : Math.abs(priced - grid) <= 0.05 ? roundKwh(costCt / 100) : null,
		plannedPvEnergyKwh: roundKwh(pv),
		plannedGridEnergyKwh: roundKwh(grid),
		plannedFirstStart: first,
		plannedLastEnd: last,
		planQuality,
		externalAuthorityState: wb.externalAuthorityState ?? null,
		takeoverSeverity: wb.takeoverSeverity ?? null,
		explain: {
			energyUnit: classes.energyUnit,
			insufficientData: classes.insufficientData,
			energyGoalHard: classes.energyGoalHard,
			targetFlexEnergyKwh: classes.targetFlexEnergyKwh,
			connectedNow: wb.connectedNow,
			vehicleSocPct: wb.vehicleSocPct,
			targetSocPct: wb.targetSocPct,
			minimumDepartureSocPct: wb.minimumDepartureSocPct ?? null,
			externalSmartChargingMinSocPct: wb.externalSmartChargingMinSocPct ?? null,
			deadlineIso: wb.deadlineIso,
			maxChargePowerW: wb.maxChargePowerW,
			chargingEfficiency: wb.chargingEfficiency ?? null,
			chargeLossFactor: wb.chargingEfficiency != null ? 1 : (wb.chargeLossFactor ?? 1),
			externalReservations: reservations,
			emsSlots: planSlots,
			dispatchPrepared: evDispatchWallboxEntries(mode),
		},
	};
}
