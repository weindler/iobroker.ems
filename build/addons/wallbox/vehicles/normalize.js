"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeWallboxVehicleProfiles = exports.normalizeWallboxVehicleProfile = void 0;
const vehicle_id_1 = require("./vehicle_id");
function strOrNull(raw) {
    if (raw === null || raw === undefined)
        return null;
    const s = String(raw).trim();
    return s || null;
}
function boolOrDefault(raw, fallback) {
    return typeof raw === "boolean" ? raw : fallback;
}
function parseSource(raw) {
    const s = String(raw ?? "").trim().toLowerCase();
    if (s === "evcc" || s === "hybrid" || s === "manual")
        return s;
    return "manual";
}
function parseOptionalPositiveNumber(raw, field, invalid) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) {
        invalid.push(field);
        return null;
    }
    if (n <= 0) {
        invalid.push(field);
        return null;
    }
    return n;
}
function parseOptionalNonNegativeNumber(raw, field, invalid) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) {
        invalid.push(field);
        return null;
    }
    if (n < 0) {
        invalid.push(field);
        return null;
    }
    return n;
}
function parseOptionalSoc(raw, field, invalid) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) {
        invalid.push(field);
        return null;
    }
    if (n < 0 || n > 100) {
        invalid.push(field);
        return null;
    }
    return n;
}
function parseOptionalEfficiency(raw, field, invalid) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
    if (!Number.isFinite(n)) {
        invalid.push(field);
        return null;
    }
    if (n <= 0 || n > 100) {
        invalid.push(field);
        return null;
    }
    return n;
}
function parsePhases(raw, field, invalid) {
    if (raw === null || raw === undefined || raw === "")
        return [];
    if (typeof raw === "number" && Number.isFinite(raw)) {
        const n = Math.floor(raw);
        if (n <= 0) {
            invalid.push(field);
            return [];
        }
        return [n];
    }
    const s = String(raw).trim();
    if (!s)
        return [];
    const parts = s.split(/[,;\s]+/).map((p) => parseInt(p.trim(), 10));
    const out = [];
    for (const p of parts) {
        if (!Number.isFinite(p) || p <= 0) {
            invalid.push(field);
            return [];
        }
        if (!out.includes(p))
            out.push(p);
    }
    return out.sort((a, b) => a - b);
}
function parsePreferredPhases(raw, field, invalid) {
    if (raw === null || raw === undefined || raw === "")
        return null;
    const n = typeof raw === "number" ? raw : parseInt(String(raw).trim(), 10);
    if (!Number.isFinite(n) || n <= 0) {
        invalid.push(field);
        return null;
    }
    return n;
}
function validateSocOrdering(profile, invalid) {
    const { minimumDepartureSocPct: min, defaultTargetSocPct: target, maximumSocPct: max } = profile;
    if (min !== null && target !== null && min > target) {
        invalid.push("minimumDepartureSocPct");
    }
    if (target !== null && max !== null && target > max) {
        invalid.push("defaultTargetSocPct");
    }
    if (min !== null && max !== null && min > max) {
        invalid.push("minimumDepartureSocPct");
    }
}
function validateCurrentOrdering(profile, invalid) {
    const { minCurrentA, maxCurrentA } = profile;
    if (minCurrentA !== null && maxCurrentA !== null && maxCurrentA < minCurrentA) {
        invalid.push("maxCurrentA");
    }
}
/** Pure normalization — no IO, no state reads. */
function normalizeWallboxVehicleProfile(input, nowIso) {
    const invalidFields = [];
    const reasons = [];
    const idResult = (0, vehicle_id_1.sanitizeVehicleId)(input.vehicleId);
    if (!idResult.valid || !idResult.id) {
        reasons.push("vehicle_id_invalid");
        return { profile: null, invalidFields: ["vehicleId"], reasons };
    }
    const displayName = strOrNull(input.displayName) ?? idResult.id;
    const enabled = boolOrDefault(input.enabled, true);
    const isGuest = boolOrDefault(input.isGuest, false) || idResult.id === "guest";
    const source = parseSource(input.source);
    const profile = {
        vehicleId: idResult.id,
        displayName,
        enabled,
        isGuest,
        source,
        evccVehicleId: (0, vehicle_id_1.normalizeEvccMatchToken)(input.evccVehicleId),
        evccVehicleName: (0, vehicle_id_1.normalizeEvccMatchToken)(input.evccVehicleName),
        batteryCapacityNetKwh: parseOptionalPositiveNumber(input.batteryCapacityNetKwh, "batteryCapacityNetKwh", invalidFields),
        maxAcChargePowerW: parseOptionalPositiveNumber(input.maxAcChargePowerW, "maxAcChargePowerW", invalidFields),
        supportedPhases: parsePhases(input.supportedPhases, "supportedPhases", invalidFields),
        preferredPhases: parsePreferredPhases(input.preferredPhases, "preferredPhases", invalidFields),
        minCurrentA: parseOptionalNonNegativeNumber(input.minCurrentA, "minCurrentA", invalidFields),
        maxCurrentA: parseOptionalPositiveNumber(input.maxCurrentA, "maxCurrentA", invalidFields),
        defaultTargetSocPct: parseOptionalSoc(input.defaultTargetSocPct, "defaultTargetSocPct", invalidFields),
        minimumDepartureSocPct: parseOptionalSoc(input.minimumDepartureSocPct, "minimumDepartureSocPct", invalidFields),
        maximumSocPct: parseOptionalSoc(input.maximumSocPct, "maximumSocPct", invalidFields),
        chargeEfficiencyPct: parseOptionalEfficiency(input.chargeEfficiencyPct, "chargeEfficiencyPct", invalidFields),
        referenceRangeAt100PctKm: parseOptionalPositiveNumber(input.referenceRangeAt100PctKm, "referenceRangeAt100PctKm", invalidFields),
        socFallbackMaxAgeMin: parseOptionalNonNegativeNumber(input.socFallbackMaxAgeMin, "socFallbackMaxAgeMin", invalidFields),
        socStateId: strOrNull(input.socState),
        rangeStateId: strOrNull(input.rangeState),
        connectedStateId: strOrNull(input.connectedState),
        chargingStateId: strOrNull(input.chargingState),
        sessionEnergyStateId: strOrNull(input.sessionEnergyState),
        createdAt: nowIso,
        updatedAt: nowIso,
    };
    validateSocOrdering(profile, invalidFields);
    validateCurrentOrdering(profile, invalidFields);
    if ((source === "evcc" || source === "hybrid") && !profile.evccVehicleId && !profile.evccVehicleName) {
        reasons.push("vehicle_evcc_mapping_missing");
    }
    if (invalidFields.length > 0) {
        reasons.push("vehicle_profile_invalid");
    }
    return { profile, invalidFields, reasons };
}
exports.normalizeWallboxVehicleProfile = normalizeWallboxVehicleProfile;
function normalizeWallboxVehicleProfiles(inputs, nowIso) {
    const profiles = [];
    const errors = [];
    const seenIds = new Set();
    for (const input of inputs) {
        const result = normalizeWallboxVehicleProfile(input, nowIso);
        if (!result.profile) {
            errors.push({ slotIndex: input.slotIndex, reasons: result.reasons });
            continue;
        }
        if (seenIds.has(result.profile.vehicleId)) {
            errors.push({ slotIndex: input.slotIndex, reasons: ["vehicle_id_duplicate"] });
            continue;
        }
        seenIds.add(result.profile.vehicleId);
        if (result.invalidFields.length > 0) {
            errors.push({ slotIndex: input.slotIndex, reasons: result.reasons });
        }
        profiles.push(result.profile);
    }
    return { profiles, errors };
}
exports.normalizeWallboxVehicleProfiles = normalizeWallboxVehicleProfiles;
