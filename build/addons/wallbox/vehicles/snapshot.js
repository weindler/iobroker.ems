"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.assessActiveProfileReadiness = exports.activeVehicleSnapshotJson = exports.buildActiveVehicleSnapshot = void 0;
const types_1 = require("./types");
const readiness_1 = require("./readiness");
function buildActiveVehicleSnapshot(input) {
    const { resolution, profile, readiness, telemetry, now } = input;
    const reasons = [...resolution.reasons];
    const connected = telemetry.connected === true;
    const charging = telemetry.charging === true;
    const profileResolved = resolution.profileResolved;
    const activeForCharging = resolution.activeForCharging;
    if (!profileResolved || !profile) {
        if (!reasons.includes(types_1.VEHICLE_REASON_CODES.unknown)) {
            reasons.push(types_1.VEHICLE_REASON_CODES.unknown);
        }
        return {
            profileResolved: false,
            activeForCharging: false,
            vehicleId: resolution.vehicleId || null,
            displayName: resolution.displayName,
            source: resolution.source,
            connected,
            charging,
            socPct: telemetry.socPct,
            socSource: telemetry.socSource,
            socQuality: telemetry.socQuality,
            rangeKm: telemetry.rangeKm,
            batteryCapacityNetKwh: null,
            maxAcChargePowerW: null,
            supportedPhases: [],
            preferredPhases: null,
            minCurrentA: null,
            maxCurrentA: null,
            defaultTargetSocPct: null,
            minimumDepartureSocPct: null,
            maximumSocPct: null,
            chargeEfficiencyPct: null,
            planningCapability: "insufficient",
            reasons,
            createdAt: now.toISOString(),
        };
    }
    if (profile.isGuest) {
        reasons.push(types_1.VEHICLE_REASON_CODES.guestExplicit);
    }
    const planningCapability = readiness?.planningCapability ?? "insufficient";
    if (planningCapability === "insufficient") {
        reasons.push(types_1.VEHICLE_REASON_CODES.profileInvalid);
    }
    if (telemetry.socPct === null && !profile.isGuest) {
        if (!reasons.includes(types_1.VEHICLE_REASON_CODES.socUnavailable)) {
            reasons.push(types_1.VEHICLE_REASON_CODES.socUnavailable);
        }
    }
    if (profile.batteryCapacityNetKwh === null && !profile.isGuest) {
        if (!reasons.includes(types_1.VEHICLE_REASON_CODES.capacityUnavailable)) {
            reasons.push(types_1.VEHICLE_REASON_CODES.capacityUnavailable);
        }
    }
    if (!connected && profileResolved) {
        if (!reasons.includes(types_1.VEHICLE_REASON_CODES.notConnected)) {
            reasons.push(types_1.VEHICLE_REASON_CODES.notConnected);
        }
    }
    return {
        profileResolved: true,
        activeForCharging,
        vehicleId: profile.vehicleId,
        displayName: profile.displayName,
        source: resolution.source,
        connected,
        charging,
        socPct: telemetry.socPct,
        socSource: telemetry.socSource,
        socQuality: telemetry.socQuality,
        rangeKm: telemetry.rangeKm,
        batteryCapacityNetKwh: profile.batteryCapacityNetKwh,
        maxAcChargePowerW: profile.maxAcChargePowerW,
        supportedPhases: [...profile.supportedPhases],
        preferredPhases: profile.preferredPhases,
        minCurrentA: profile.minCurrentA,
        maxCurrentA: profile.maxCurrentA,
        defaultTargetSocPct: profile.defaultTargetSocPct,
        minimumDepartureSocPct: profile.minimumDepartureSocPct,
        maximumSocPct: profile.maximumSocPct,
        chargeEfficiencyPct: profile.chargeEfficiencyPct,
        planningCapability,
        reasons: [...new Set(reasons)],
        createdAt: now.toISOString(),
    };
}
exports.buildActiveVehicleSnapshot = buildActiveVehicleSnapshot;
function activeVehicleSnapshotJson(snapshot) {
    return JSON.stringify(snapshot);
}
exports.activeVehicleSnapshotJson = activeVehicleSnapshotJson;
function assessActiveProfileReadiness(profile, telemetry, invalidFields = []) {
    return (0, readiness_1.assessWallboxVehicleProfileReadiness)(profile, telemetry, invalidFields);
}
exports.assessActiveProfileReadiness = assessActiveProfileReadiness;
