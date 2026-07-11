"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pickTelemetryFieldNumber = exports.pickTelemetryFieldBool = exports.pickEvccConnected = exports.resolveActiveVehicle = void 0;
const types_1 = require("./types");
const vehicle_id_1 = require("./vehicle_id");
function profileMatchesEvcc(profile, detection) {
    if (!profile.enabled)
        return false;
    if (profile.source !== "evcc" && profile.source !== "hybrid")
        return false;
    if (profile.evccVehicleId && detection.evccVehicleId) {
        return (0, vehicle_id_1.evccTokensMatch)(profile.evccVehicleId, detection.evccVehicleId);
    }
    if (profile.evccVehicleName && detection.evccVehicleName) {
        return (0, vehicle_id_1.evccTokensMatch)(profile.evccVehicleName, detection.evccVehicleName);
    }
    return false;
}
function findByManualId(profiles, manualId) {
    if (!manualId)
        return null;
    const match = profiles.find((p) => p.enabled && p.vehicleId === manualId);
    return match ?? null;
}
function enabledProfiles(profiles) {
    return profiles.filter((p) => p.enabled);
}
function resolveByEvcc(profiles, detection) {
    return profiles.filter((p) => profileMatchesEvcc(p, detection));
}
function resolveBySingleEnabled(profiles) {
    const enabled = enabledProfiles(profiles);
    if (enabled.length === 1)
        return enabled[0];
    return null;
}
function resolveProfileIdentity(profiles, configuredManualVehicleId, evccDetection) {
    const manualSanitized = configuredManualVehicleId?.trim() || null;
    const evccMatches = resolveByEvcc(profiles, evccDetection);
    if (evccMatches.length > 1) {
        return {
            profileResolved: false,
            vehicleId: "",
            displayName: null,
            source: "unknown",
            detectionStatus: "ambiguous",
            confidence: 0,
            reasons: [types_1.VEHICLE_REASON_CODES.resolutionAmbiguous],
        };
    }
    if (evccMatches.length === 1) {
        const p = evccMatches[0];
        return {
            profileResolved: true,
            vehicleId: p.vehicleId,
            displayName: p.displayName,
            source: "evcc",
            detectionStatus: "resolved",
            confidence: 0.95,
            reasons: [types_1.VEHICLE_REASON_CODES.evccMatch],
        };
    }
    if (manualSanitized) {
        const manualMatch = findByManualId(profiles, manualSanitized);
        if (!manualMatch) {
            return {
                profileResolved: false,
                vehicleId: null,
                displayName: null,
                source: "unknown",
                detectionStatus: "invalid_manual",
                confidence: 0,
                reasons: [types_1.VEHICLE_REASON_CODES.manualSelectionInvalid],
            };
        }
        if (manualMatch.isGuest) {
            return {
                profileResolved: true,
                vehicleId: manualMatch.vehicleId,
                displayName: manualMatch.displayName,
                source: "guest",
                detectionStatus: "resolved",
                confidence: 0.7,
                reasons: [types_1.VEHICLE_REASON_CODES.guestExplicit],
            };
        }
        return {
            profileResolved: true,
            vehicleId: manualMatch.vehicleId,
            displayName: manualMatch.displayName,
            source: "manual",
            detectionStatus: "resolved",
            confidence: 0.75,
            reasons: [types_1.VEHICLE_REASON_CODES.manualMatch],
        };
    }
    const single = resolveBySingleEnabled(profiles);
    if (single) {
        const source = single.isGuest ? "guest" : "single_enabled_profile";
        return {
            profileResolved: true,
            vehicleId: single.vehicleId,
            displayName: single.displayName,
            source,
            detectionStatus: "resolved",
            confidence: 0.6,
            reasons: [types_1.VEHICLE_REASON_CODES.singleEnabledProfile],
        };
    }
    const enabled = enabledProfiles(profiles);
    if (enabled.length === 0) {
        return {
            profileResolved: false,
            vehicleId: null,
            displayName: null,
            source: "unknown",
            detectionStatus: "no_profile",
            confidence: 0,
            reasons: [types_1.VEHICLE_REASON_CODES.profileMissing],
        };
    }
    return {
        profileResolved: false,
        vehicleId: "",
        displayName: null,
        source: "unknown",
        detectionStatus: "ambiguous",
        confidence: 0,
        reasons: [types_1.VEHICLE_REASON_CODES.resolutionAmbiguous, types_1.VEHICLE_REASON_CODES.unknown],
    };
}
/** Priority: EVCC match → manual fallback → single enabled profile → unknown/ambiguous. Connection is applied separately. */
function resolveActiveVehicle(input) {
    const identity = resolveProfileIdentity(input.profiles, input.configuredManualVehicleId, input.evccDetection);
    const connected = input.evccConnected === true;
    const activeForCharging = identity.profileResolved && connected;
    const reasons = [...identity.reasons];
    let detectionStatus = identity.detectionStatus;
    if (identity.profileResolved && !connected) {
        detectionStatus = "disconnected";
        if (!reasons.includes(types_1.VEHICLE_REASON_CODES.notConnected)) {
            reasons.push(types_1.VEHICLE_REASON_CODES.notConnected);
        }
        if (!reasons.includes(types_1.VEHICLE_REASON_CODES.disconnected)) {
            reasons.push(types_1.VEHICLE_REASON_CODES.disconnected);
        }
    }
    else if (identity.profileResolved && connected) {
        detectionStatus = "resolved";
    }
    return {
        profileResolved: identity.profileResolved,
        vehicleId: identity.vehicleId,
        displayName: identity.displayName,
        source: identity.source,
        detectionStatus,
        confidence: identity.confidence,
        configuredManualVehicleId: input.configuredManualVehicleId?.trim() || null,
        connected: input.evccConnected,
        activeForCharging,
        reasons,
    };
}
exports.resolveActiveVehicle = resolveActiveVehicle;
function pickEvccConnected(snap) {
    const f = snap.connected;
    if (f.status === "valid" && typeof f.value === "boolean")
        return f.value;
    return null;
}
exports.pickEvccConnected = pickEvccConnected;
function pickTelemetryFieldBool(field) {
    if (field.status === "valid" && typeof field.value === "boolean")
        return field.value;
    return null;
}
exports.pickTelemetryFieldBool = pickTelemetryFieldBool;
function pickTelemetryFieldNumber(field) {
    if (field.status === "valid" && typeof field.value === "number" && Number.isFinite(field.value)) {
        return field.value;
    }
    return null;
}
exports.pickTelemetryFieldNumber = pickTelemetryFieldNumber;
