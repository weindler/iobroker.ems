"use strict";
/**
 * latestRequiredStart only for a real deadline + real minimum requirement.
 * Target SOC alone never creates a deadline.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.computeDeadlineRisk = exports.computeLatestRequiredStartIso = exports.resolveDecisionDeadlineIso = exports.parseDeadlineMs = void 0;
const time_1 = require("../../../../operator/time");
const smart_plan_parse_1 = require("../external/smart_plan_parse");
function parseDeadlineMs(raw) {
    if (raw == null || raw === "")
        return null;
    return (0, smart_plan_parse_1.parseTimestampToMs)(raw);
}
exports.parseDeadlineMs = parseDeadlineMs;
/**
 * Prefer configured departure, then an explicit external deadline, then availability.
 * Never derived from target SOC.
 */
function resolveDecisionDeadlineIso(input) {
    const fromDeparture = parseDeadlineMs(input.departureAt);
    if (fromDeparture != null)
        return (0, time_1.isoFromMs)(fromDeparture);
    const fromExternal = parseDeadlineMs(input.externalDeadlineIso);
    if (fromExternal != null)
        return (0, time_1.isoFromMs)(fromExternal);
    const fromAvail = parseDeadlineMs(input.vehicleAvailableUntil);
    if (fromAvail != null)
        return (0, time_1.isoFromMs)(fromAvail);
    return null;
}
exports.resolveDecisionDeadlineIso = resolveDecisionDeadlineIso;
function computeLatestRequiredStartIso(input) {
    if (input.deadlineMs == null || !Number.isFinite(input.deadlineMs))
        return null;
    if (input.energyToRequirementKWh == null)
        return null;
    if (input.energyToRequirementKWh <= 0)
        return null;
    if (input.requiredChargingMinutes == null)
        return null;
    if (input.vehicleSocPct == null || input.batteryCapacityKWh == null)
        return null;
    if (input.chargePowerKw == null || input.chargePowerKw <= 0)
        return null;
    const margin = input.safetyMarginMin != null && input.safetyMarginMin >= 0 ? input.safetyMarginMin : 0;
    const latestMs = input.deadlineMs - (input.requiredChargingMinutes + margin) * 60_000;
    if (!Number.isFinite(latestMs))
        return null;
    return (0, time_1.isoFromMs)(latestMs);
}
exports.computeLatestRequiredStartIso = computeLatestRequiredStartIso;
function computeDeadlineRisk(input) {
    if (input.deadlineMs == null)
        return false;
    if (input.energyToRequirementKWh == null)
        return null;
    if (input.energyToRequirementKWh <= 0)
        return false;
    if (input.requiredChargingMinutes == null || input.latestRequiredStart == null)
        return null;
    const latestMs = Date.parse(input.latestRequiredStart);
    if (!Number.isFinite(latestMs))
        return null;
    return input.nowMs >= latestMs;
}
exports.computeDeadlineRisk = computeDeadlineRisk;
