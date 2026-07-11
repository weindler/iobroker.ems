"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveActiveVehicleChargeLimits = void 0;
const types_1 = require("./types");
function resolveActiveVehicleChargeLimits(snapshot) {
    const reasons = [];
    if (!snapshot.profileResolved) {
        reasons.push(types_1.VEHICLE_REASON_CODES.unknown);
        return {
            maxAcChargePowerW: null,
            minCurrentA: null,
            maxCurrentA: null,
            phases: null,
            ready: false,
            source: snapshot.source,
            reasons,
        };
    }
    const hasPower = snapshot.maxAcChargePowerW !== null;
    const hasCurrent = snapshot.minCurrentA !== null || snapshot.maxCurrentA !== null;
    const hasPhases = snapshot.supportedPhases.length > 0 || snapshot.preferredPhases !== null;
    if (!hasPower && !hasCurrent && !hasPhases) {
        reasons.push(types_1.VEHICLE_REASON_CODES.chargeLimitsUnavailable);
        return {
            maxAcChargePowerW: null,
            minCurrentA: null,
            maxCurrentA: null,
            phases: null,
            ready: false,
            source: "profile",
            reasons,
        };
    }
    const phases = snapshot.preferredPhases ??
        (snapshot.supportedPhases.length === 1 ? snapshot.supportedPhases[0] : null);
    return {
        maxAcChargePowerW: snapshot.maxAcChargePowerW,
        minCurrentA: snapshot.minCurrentA,
        maxCurrentA: snapshot.maxCurrentA,
        phases,
        ready: true,
        source: "profile",
        reasons,
    };
}
exports.resolveActiveVehicleChargeLimits = resolveActiveVehicleChargeLimits;
