/**
 * Climate-Slot- und Mode-Hilfen für Day-Telemetry.
 * Keine erfundenen Werte, keine operative Steuerung.
 */

import {
	coolingDemandUrgency01,
	dehumidifyDemandUrgency01,
} from "../../addons/air_conditioning/runtime/hard_off_worth_it";
import type { ClimateModePurpose } from "./types";

export function normalizeClimateModePurpose(raw: string | null | undefined): ClimateModePurpose {
	const s = (raw ?? "").trim().toLowerCase();
	if (!s || s === "off" || s === "none" || s === "idle") return "off";
	if (s === "cooling" || s === "cool") return "cooling";
	if (s === "heating" || s === "heat") return "heating";
	if (s === "dehumidify" || s === "dry" || s === "dehumidification") return "dehumidify";
	return "unknown";
}

/**
 * Dringlichkeit nur wenn die zugrunde liegenden Sensorwerte da sind.
 * coolingDemandUrgency01 liefert bei fehlender Raumtemperatur 0 — das wäre hier erfunden.
 */
export function climateSlotDemandUrgency01(input: {
	modePurpose: ClimateModePurpose;
	roomTempC: number | null;
	coolingOnTempC: number | null;
	roomHumidityPct: number | null;
	maxHumidityPct: number | null;
}): number | null {
	if (input.modePurpose === "cooling") {
		if (input.roomTempC == null || input.coolingOnTempC == null) return null;
		return coolingDemandUrgency01(input.roomTempC, input.coolingOnTempC);
	}
	if (input.modePurpose === "dehumidify") {
		if (input.roomHumidityPct == null || input.maxHumidityPct == null) return null;
		return dehumidifyDemandUrgency01(input.roomHumidityPct, input.maxHumidityPct);
	}
	return null;
}

export function climateOverrideActive(
	owner: string | null,
	overrideUntilIso: string | null,
	nowMs: number,
): boolean | null {
	if (owner == null && overrideUntilIso == null) return null;
	if (owner === "user" || owner === "external") return true;
	if (overrideUntilIso) {
		const until = Date.parse(overrideUntilIso);
		if (Number.isFinite(until) && until > nowMs) return true;
	}
	return false;
}
