/**
 * Sicheres Verhalten bei fehlgeschlagenem Unified Replan (LIVE IH/AC/Battery/Wallbox).
 * Kein Classic-Planner-Takeover. Planner schreibt keine Geräte.
 */

import type { DailyPlan } from "../types";
import {
	applyUnifiedDayAuthority,
	clearAllUnifiedAuthority,
	clearIhAcAuthority,
} from "./authority";
import { buildUnifiedDispatchPublish, buildUnifiedIhAcDispatchPublish } from "./dispatch_bridge";
import type { PlanActualSample } from "./materiality";
import { REASON } from "./reason_codes";
import type {
	UnifiedBatteryInput,
	UnifiedClimateInput,
	UnifiedDayPlan,
	UnifiedThermalInput,
	UnifiedWallboxInput,
} from "./types";

export type ReplanFailureDisposition = {
	clearImmersion: boolean;
	clearClimate: boolean;
	/** Battery Charge-Slice entfernen → Runtime Hold/kein veralteter Charge-Intent. */
	clearBattery: boolean;
	/** Wallbox-Slice entfernen → EVCC bleibt manuell nutzbar, kein stale EMS-Charge. */
	clearWallbox: boolean;
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
	if (age !== null && age !== undefined && Number.isFinite(age) && age > 30 * 60) return false;
	return true;
}

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

export function climatePlanDispatchStillSafe(args: {
	nowMs: number;
	lastUnifiedPlan: UnifiedDayPlan | null;
	actual: PlanActualSample;
	climate: UnifiedClimateInput | null | undefined;
	replanReasons: string[];
}): boolean {
	const { nowMs, lastUnifiedPlan, actual, climate, replanReasons } = args;
	if (!hasFutureKind(lastUnifiedPlan, "climate", nowMs) && !hasFutureKind(lastUnifiedPlan, "air_conditioning", nowMs)) {
		if (actual.acMandatoryAny) return false;
		return true;
	}

	if (actual.acMandatoryAny) return false;
	if (replanReasons.includes(REASON.REPLAN_AC_COMFORT_CHANGE)) return false;

	if (climate?.units.some((u) => u.uncertainty.status === "blocked")) return false;

	return true;
}

/** Battery Charge: im Zweifel idle/hold — kein veralteter Charge-Dispatch. */
export function batteryRestStillSafe(args: {
	nowMs: number;
	lastUnifiedPlan: UnifiedDayPlan | null;
	actual: PlanActualSample;
	battery: UnifiedBatteryInput | null | undefined;
	replanReasons: string[];
}): boolean {
	const { nowMs, lastUnifiedPlan, actual, battery, replanReasons } = args;
	if (!hasFutureKind(lastUnifiedPlan, "battery_charge", nowMs)) return true;
	if (!battery) return false;
	if (battery.socPct === null || battery.usableCapacityKwh === null) return false;
	const q = battery.uncertainty.status;
	if (q === "blocked" || q === "missing") return false;
	const age = battery.freshness?.ageSec;
	if (age !== null && age !== undefined && age > 30 * 60) return false;
	if (replanReasons.includes(REASON.REPLAN_BATTERY_SOC_DEVIATION)) return false;
	if (
		replanReasons.includes(REASON.REPLAN_PV_FORECAST_CHANGED) ||
		replanReasons.includes(REASON.REPLAN_PV_ACTUAL_DEVIATION)
	) {
		return false;
	}
	void actual;
	return true;
}

/**
 * Wallbox: veralteten EMS-Charge-Intent entfernen bei Disconnect/Presence/Goal-Bruch.
 * EVCC bleibt manuell bedienbar (kein Geräte-Lock).
 */
export function wallboxRestStillSafe(args: {
	nowMs: number;
	lastUnifiedPlan: UnifiedDayPlan | null;
	actual: PlanActualSample;
	wallbox: UnifiedWallboxInput | null | undefined;
	replanReasons: string[];
}): boolean {
	const { nowMs, lastUnifiedPlan, actual, wallbox, replanReasons } = args;
	if (!hasFutureKind(lastUnifiedPlan, "wallbox", nowMs)) return true;
	if (actual.vehicleConnected === false) return false;
	if (
		replanReasons.includes(REASON.REPLAN_VEHICLE_DISCONNECTED) ||
		replanReasons.includes(REASON.REPLAN_VEHICLE_PRESENCE_CHANGED) ||
		replanReasons.includes(REASON.REPLAN_VEHICLE_GOAL_CHANGED)
	) {
		return false;
	}
	if (!wallbox) return false;
	if (!wallbox.connectedNow && wallbox.presenceWindows.every((w) => !w.available && w.status !== "available")) {
		return false;
	}
	return true;
}

export function assessUnifiedReplanFailure(args: {
	nowMs: number;
	lastUnifiedPlan: UnifiedDayPlan | null;
	actual: PlanActualSample;
	thermal: UnifiedThermalInput | null | undefined;
	climate: UnifiedClimateInput | null | undefined;
	battery?: UnifiedBatteryInput | null;
	wallbox?: UnifiedWallboxInput | null;
	replanReasons: string[];
}): ReplanFailureDisposition {
	const clearImmersion = !immersionRestStillSafe(args);
	const clearClimate = !climatePlanDispatchStillSafe(args);
	const clearBattery = !batteryRestStillSafe({
		nowMs: args.nowMs,
		lastUnifiedPlan: args.lastUnifiedPlan,
		actual: args.actual,
		battery: args.battery,
		replanReasons: args.replanReasons,
	});
	const clearWallbox = !wallboxRestStillSafe({
		nowMs: args.nowMs,
		lastUnifiedPlan: args.lastUnifiedPlan,
		actual: args.actual,
		wallbox: args.wallbox,
		replanReasons: args.replanReasons,
	});

	const parts: string[] = ["Unified Replan fehlgeschlagen"];
	if (clearImmersion) parts.push("IH idle");
	else parts.push("IH behalten");
	if (clearClimate) parts.push("Klima Plan geleert");
	else parts.push("Klima behalten");
	if (clearBattery) parts.push("Battery Charge idle/hold");
	else parts.push("Battery behalten");
	if (clearWallbox) parts.push("Wallbox EMS-Intent idle (EVCC manuell ok)");
	else parts.push("Wallbox behalten");

	return {
		clearImmersion,
		clearClimate,
		clearBattery,
		clearWallbox,
		reasonDe: `${parts.join(" — ")}.`,
	};
}

export function applyReplanFailureAuthority(
	classicPlan: DailyPlan,
	lastUnifiedPlan: UnifiedDayPlan | null,
	disposition: ReplanFailureDisposition,
): DailyPlan {
	if (!lastUnifiedPlan) {
		if (
			disposition.clearImmersion ||
			disposition.clearClimate ||
			disposition.clearBattery ||
			disposition.clearWallbox
		) {
			return clearAllUnifiedAuthority(classicPlan);
		}
		return classicPlan;
	}

	const pub = buildUnifiedDispatchPublish(lastUnifiedPlan);
	const ih = disposition.clearImmersion ? [] : pub.immersionEntries;
	const ac = disposition.clearClimate ? [] : pub.climateEntries;
	const bat = disposition.clearBattery ? [] : pub.batteryEntries;
	const wb = disposition.clearWallbox ? [] : pub.wallboxEntries;

	if (
		disposition.clearImmersion &&
		disposition.clearClimate &&
		disposition.clearBattery &&
		disposition.clearWallbox
	) {
		return clearAllUnifiedAuthority(classicPlan);
	}

	// Compat: wenn nur IH/AC betroffen und battery/wallbox keep via legacy path
	if (
		!disposition.clearBattery &&
		!disposition.clearWallbox &&
		(disposition.clearImmersion || disposition.clearClimate)
	) {
		const ihAc = buildUnifiedIhAcDispatchPublish(lastUnifiedPlan);
		return applyUnifiedDayAuthority(
			classicPlan,
			{
				immersionEntries: disposition.clearImmersion ? [] : ihAc.immersionEntries,
				climateEntries: disposition.clearClimate ? [] : ihAc.climateEntries,
				batteryEntries: null,
				wallboxEntries: null,
			},
			{
				dailyPlanRevision: classicPlan.revision,
				unifiedPlanId: `${lastUnifiedPlan.planId}:replan-fail-safe`,
			},
		);
	}

	return applyUnifiedDayAuthority(
		classicPlan,
		{
			immersionEntries: ih,
			climateEntries: ac,
			batteryEntries: bat,
			wallboxEntries: wb,
		},
		{
			dailyPlanRevision: classicPlan.revision,
			unifiedPlanId: `${lastUnifiedPlan.planId}:replan-fail-safe`,
		},
	);
}

/** @deprecated — use clearAllUnifiedAuthority when clearing all live slices. */
export { clearIhAcAuthority };
