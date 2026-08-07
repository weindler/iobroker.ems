/**
 * Sicheres Verhalten bei fehlgeschlagenem Unified Replan (LIVE IH/AC).
 * Kein zweiter Klima-Tagesplaner — nur Authority-Bereinigung + bestehender AC-Runtime-Fallback.
 */

import type { DailyPlan } from "../types";
import {
	applyUnifiedIhAcAuthority,
	clearIhAcAuthority,
} from "./authority";
import { buildUnifiedIhAcDispatchPublish } from "./dispatch_bridge";
import type { PlanActualSample } from "./materiality";
import { REASON } from "./reason_codes";
import type { UnifiedClimateInput, UnifiedDayPlan, UnifiedThermalInput } from "./types";

export type ReplanFailureDisposition = {
	/** IH-Plan-Slices entfernen → Runtime idle (kein veralteter energetischer Dispatch). */
	clearImmersion: boolean;
	/**
	 * Planbasierte Klima-Slices entfernen → AC-Runtime nutzt lokalen Komfort-Fallback
	 * (`useDailyPlan=false` bei 0-W-Allocation). Kein stumpfes Abschalten der Komfortregel.
	 */
	clearClimate: boolean;
	reasonDe: string;
};

function hasFutureKind(plan: UnifiedDayPlan | null, kind: string, nowMs: number): boolean {
	if (!plan) return false;
	return plan.allocations.some(
		(a) => a.kind === kind && Number.isFinite(Date.parse(a.slot.endIso)) && Date.parse(a.slot.endIso) > nowMs,
	);
}

function thermalFreshnessOk(thermal: UnifiedThermalInput | null | undefined): boolean {
	if (!thermal) return false;
	const q = thermal.freshness?.quality?.status;
	if (q === "missing" || q === "blocked" || q === "unsupported" || q === "disabled") return false;
	if (thermal.bufferTempC === null || !Number.isFinite(thermal.bufferTempC)) return false;
	const age = thermal.freshness?.ageSec;
	// Sehr altes Telemetrie-Signal → nicht auf veraltetem Slice beharren
	if (age !== null && age !== undefined && Number.isFinite(age) && age > 30 * 60) return false;
	return true;
}

/**
 * IH: im Zweifel idle. Alter Rest-Slice nur behalten, wenn aktuell noch fachlich zulässig.
 */
export function immersionRestStillSafe(args: {
	nowMs: number;
	lastUnifiedPlan: UnifiedDayPlan | null;
	actual: PlanActualSample;
	thermal: UnifiedThermalInput | null | undefined;
	replanReasons: string[];
}): boolean {
	const { nowMs, lastUnifiedPlan, actual, thermal, replanReasons } = args;
	if (!hasFutureKind(lastUnifiedPlan, "immersion_heater", nowMs)) return true;

	if (actual.thermalBlocked) return false;
	if (!thermal) return false;
	if (thermal.uncertainty.status === "blocked" || thermal.uncertainty.status === "missing") {
		return false;
	}
	if (!thermalFreshnessOk(thermal)) return false;

	const head = thermal.headroomEnergyKwh ?? actual.thermalHeadroomKwh;
	// Ziel erreicht / kein Bedarf → energetischer Slice unzulässig
	if (head !== null && Number.isFinite(head) && head < 0.05) return false;

	const energyPremiseBroken = replanReasons.some(
		(r) =>
			r === REASON.REPLAN_THERMAL_DEVIATION ||
			r === REASON.REPLAN_PV_FORECAST_CHANGED ||
			r === REASON.REPLAN_PV_ACTUAL_DEVIATION,
	);
	if (energyPremiseBroken) return false;

	return true;
}

/**
 * Klima: planbasierten Flex-Dispatch nicht ungeprüft halten, wenn Komfortbedarf besteht.
 * Leeren Plan → bestehende Runtime-Komfort-FSM (Climate-Fallback), kein zweiter Planner.
 */
export function climatePlanDispatchStillSafe(args: {
	nowMs: number;
	lastUnifiedPlan: UnifiedDayPlan | null;
	actual: PlanActualSample;
	climate: UnifiedClimateInput | null | undefined;
	replanReasons: string[];
}): boolean {
	const { nowMs, lastUnifiedPlan, actual, climate, replanReasons } = args;
	if (!hasFutureKind(lastUnifiedPlan, "climate", nowMs) && !hasFutureKind(lastUnifiedPlan, "air_conditioning", nowMs)) {
		// Auch ohne zukünftige Slice: bei Komfortbedarf Plan-Authority leeren, damit lokaler Pfad greift
		if (actual.acMandatoryAny) return false;
		return true;
	}

	if (actual.acMandatoryAny) return false;
	if (replanReasons.includes(REASON.REPLAN_AC_COMFORT_CHANGE)) return false;

	if (climate?.units.some((u) => u.uncertainty.status === "blocked")) return false;

	return true;
}

export function assessUnifiedReplanFailure(args: {
	nowMs: number;
	lastUnifiedPlan: UnifiedDayPlan | null;
	actual: PlanActualSample;
	thermal: UnifiedThermalInput | null | undefined;
	climate: UnifiedClimateInput | null | undefined;
	replanReasons: string[];
}): ReplanFailureDisposition {
	const clearImmersion = !immersionRestStillSafe(args);
	const clearClimate = !climatePlanDispatchStillSafe(args);

	const parts: string[] = ["Unified Replan fehlgeschlagen"];
	if (clearImmersion) parts.push("IH idle (Rest-Slice nicht mehr zulässig)");
	else parts.push("IH Restplan behalten");
	if (clearClimate) parts.push("Klima Plan-Dispatch geleert (lokaler Komfort-Pfad)");
	else parts.push("Klima Restplan behalten");

	return {
		clearImmersion,
		clearClimate,
		reasonDe: `${parts.join(" — ")}.`,
	};
}

/**
 * Wendet Failure-Disposition auf den frischen Classic-Daily-Plan an.
 * Nutzt den letzten gültigen Unified-Plan als Quelle verbleibender Slices.
 * Publiziert nie eine neue Unified-Generation.
 */
export function applyReplanFailureAuthority(
	classicPlan: DailyPlan,
	lastUnifiedPlan: UnifiedDayPlan | null,
	disposition: ReplanFailureDisposition,
): DailyPlan {
	if (!lastUnifiedPlan) {
		if (disposition.clearImmersion || disposition.clearClimate) {
			return clearIhAcAuthority(classicPlan);
		}
		return classicPlan;
	}

	const pub = buildUnifiedIhAcDispatchPublish(lastUnifiedPlan);
	const ih = disposition.clearImmersion ? [] : pub.immersionEntries;
	const ac = disposition.clearClimate ? [] : pub.climateEntries;

	if (disposition.clearImmersion && disposition.clearClimate) {
		return clearIhAcAuthority(classicPlan);
	}

	return applyUnifiedIhAcAuthority(classicPlan, ih, ac, {
		dailyPlanRevision: classicPlan.revision,
		unifiedPlanId: `${lastUnifiedPlan.planId}:replan-fail-safe`,
	});
}
