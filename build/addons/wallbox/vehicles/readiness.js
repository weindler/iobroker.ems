"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessWallboxVehicleProfileReadiness = exports.derivePlanningCapability = void 0;
const types_1 = require("./types");
function hasChargeLimits(profile) {
    return (profile.maxAcChargePowerW !== null ||
        profile.minCurrentA !== null ||
        profile.maxCurrentA !== null ||
        profile.supportedPhases.length > 0 ||
        profile.preferredPhases !== null);
}
function derivePlanningCapability(profile, telemetry) {
    const socAvailable = telemetry.socPct !== null;
    const capacityAvailable = profile.batteryCapacityNetKwh !== null;
    const limitsAvailable = hasChargeLimits(profile);
    if (socAvailable && capacityAvailable) {
        return "soc_and_capacity";
    }
    if (capacityAvailable) {
        return "energy_only";
    }
    if (limitsAvailable) {
        return "limits_only";
    }
    return "insufficient";
}
exports.derivePlanningCapability = derivePlanningCapability;
function assessWallboxVehicleProfileReadiness(profile, telemetry, invalidFields = []) {
    const missingFields = [];
    const invalid = [...invalidFields];
    const reasons = [];
    if (!profile.enabled) {
        reasons.push(types_1.VEHICLE_REASON_CODES.profileDisabled);
    }
    const profileValid = invalid.length === 0 && profile.vehicleId.length > 0;
    if (!profileValid) {
        reasons.push(types_1.VEHICLE_REASON_CODES.profileInvalid);
    }
    const connectedKnown = telemetry.connected !== null;
    const chargingKnown = telemetry.charging !== null;
    const socAvailable = telemetry.socPct !== null;
    const capacityAvailable = profile.batteryCapacityNetKwh !== null;
    const chargeLimitsAvailable = hasChargeLimits(profile);
    if (!socAvailable && profileValid) {
        missingFields.push("socPct");
        reasons.push(types_1.VEHICLE_REASON_CODES.socUnavailable);
    }
    if (!capacityAvailable && profileValid && !profile.isGuest) {
        missingFields.push("batteryCapacityNetKwh");
    }
    if (!chargeLimitsAvailable && profileValid) {
        missingFields.push("chargeLimits");
        reasons.push(types_1.VEHICLE_REASON_CODES.chargeLimitsUnavailable);
    }
    if (profile.defaultTargetSocPct === null &&
        profile.minimumDepartureSocPct === null &&
        profileValid &&
        !profile.isGuest) {
        missingFields.push("targetSoc");
    }
    const telemetryReady = profileValid &&
        connectedKnown &&
        (chargingKnown || !profile.chargingStateId) &&
        (socAvailable || profile.isGuest || profile.source === "manual");
    const planningCapability = derivePlanningCapability(profile, telemetry);
    const planningReady = profileValid &&
        telemetryReady &&
        planningCapability !== "insufficient" &&
        !(telemetry.connected === false);
    return {
        profileValid,
        telemetryReady,
        planningReady,
        socAvailable,
        capacityAvailable,
        chargeLimitsAvailable,
        planningCapability,
        missingFields,
        invalidFields: invalid,
        reasons,
    };
}
exports.assessWallboxVehicleProfileReadiness = assessWallboxVehicleProfileReadiness;
