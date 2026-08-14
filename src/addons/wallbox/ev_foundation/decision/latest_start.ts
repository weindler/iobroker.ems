/**
 * latestRequiredStart only for a real deadline + real minimum requirement.
 * Target SOC alone never creates a deadline.
 */

import { isoFromMs } from "../../../../operator/time";
import { parseTimestampToMs } from "../external/smart_plan_parse";

export function parseDeadlineMs(raw: string | null | undefined): number | null {
	if (raw == null || raw === "") return null;
	return parseTimestampToMs(raw);
}

/**
 * Prefer configured departure, then an explicit external deadline, then availability.
 * Never derived from target SOC.
 */
export function resolveDecisionDeadlineIso(input: {
	departureAt: string | null;
	vehicleAvailableUntil: string | null;
	externalDeadlineIso: string | null;
}): string | null {
	const fromDeparture = parseDeadlineMs(input.departureAt);
	if (fromDeparture != null) return isoFromMs(fromDeparture);
	const fromExternal = parseDeadlineMs(input.externalDeadlineIso);
	if (fromExternal != null) return isoFromMs(fromExternal);
	const fromAvail = parseDeadlineMs(input.vehicleAvailableUntil);
	if (fromAvail != null) return isoFromMs(fromAvail);
	return null;
}

export function computeLatestRequiredStartIso(input: {
	deadlineMs: number | null;
	requiredChargingMinutes: number | null;
	safetyMarginMin: number | null;
	/** Hard requirement energy. 0 → already satisfied, no latest start. */
	energyToRequirementKWh: number | null;
	vehicleSocPct: number | null;
	batteryCapacityKWh: number | null;
	chargePowerKw: number | null;
}): string | null {
	if (input.deadlineMs == null || !Number.isFinite(input.deadlineMs)) return null;
	if (input.energyToRequirementKWh == null) return null;
	if (input.energyToRequirementKWh <= 0) return null;
	if (input.requiredChargingMinutes == null) return null;
	if (input.vehicleSocPct == null || input.batteryCapacityKWh == null) return null;
	if (input.chargePowerKw == null || input.chargePowerKw <= 0) return null;
	const margin = input.safetyMarginMin != null && input.safetyMarginMin >= 0 ? input.safetyMarginMin : 0;
	const latestMs = input.deadlineMs - (input.requiredChargingMinutes + margin) * 60_000;
	if (!Number.isFinite(latestMs)) return null;
	return isoFromMs(latestMs);
}

export function computeDeadlineRisk(input: {
	deadlineMs: number | null;
	latestRequiredStart: string | null;
	nowMs: number;
	requiredChargingMinutes: number | null;
	energyToRequirementKWh: number | null;
}): boolean | null {
	if (input.deadlineMs == null) return false;
	if (input.energyToRequirementKWh == null) return null;
	if (input.energyToRequirementKWh <= 0) return false;
	if (input.requiredChargingMinutes == null || input.latestRequiredStart == null) return null;
	const latestMs = Date.parse(input.latestRequiredStart);
	if (!Number.isFinite(latestMs)) return null;
	return input.nowMs >= latestMs;
}
