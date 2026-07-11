"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.roundPublishedSocPct = exports.roundPublishedEnergyKwh = exports.buildSocEnergyInput = exports.resolveVehicleSocAndEnergy = exports.isValidDirectSocPct = void 0;
const types_1 = require("./types");
const soc_1 = require("./soc");
function isValidDirectSocPct(value) {
    if (value === null || value === undefined)
        return false;
    if (typeof value !== "number" || !Number.isFinite(value))
        return false;
    return value >= 0 && value <= 100;
}
exports.isValidDirectSocPct = isValidDirectSocPct;
function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}
function emptyResolution(vehicleId, reasonCode) {
    return {
        vehicleId,
        resolvedSocPct: null,
        socSource: "unknown",
        socQuality: "none",
        socEstimated: false,
        usableCapacityKwh: null,
        currentBatteryEnergyKwh: null,
        targetBatteryEnergyKwh: null,
        requiredBatteryEnergyKwh: null,
        requiredInputEnergyKwh: null,
        targetSocPct: null,
        ready: false,
        reasonCode,
        baselineValid: false,
    };
}
function usableCapacity(profile) {
    const cap = profile.batteryCapacityNetKwh;
    if (cap === null || !Number.isFinite(cap) || cap <= 0)
        return null;
    return cap;
}
function targetSocPct(profile) {
    const t = profile.defaultTargetSocPct;
    if (t === null || !Number.isFinite(t) || t < 0 || t > 100)
        return null;
    return t;
}
function computeEnergyFields(resolvedSocPct, capacityKwh, targetPct, chargeEfficiencyPct) {
    const currentBatteryEnergyKwh = (capacityKwh * resolvedSocPct) / 100;
    const targetBatteryEnergyKwh = (capacityKwh * targetPct) / 100;
    const requiredBatteryEnergyKwh = Math.max(0, targetBatteryEnergyKwh - currentBatteryEnergyKwh);
    let requiredInputEnergyKwh = null;
    if (chargeEfficiencyPct !== null &&
        Number.isFinite(chargeEfficiencyPct) &&
        chargeEfficiencyPct > 0 &&
        chargeEfficiencyPct <= 100) {
        requiredInputEnergyKwh = requiredBatteryEnergyKwh / (chargeEfficiencyPct / 100);
    }
    return {
        currentBatteryEnergyKwh,
        targetBatteryEnergyKwh,
        requiredBatteryEnergyKwh,
        requiredInputEnergyKwh,
    };
}
function attachEnergy(base, profile) {
    const capacity = usableCapacity(profile);
    const target = targetSocPct(profile);
    if (capacity === null) {
        return { ...base, usableCapacityKwh: null, reasonCode: types_1.SOC_ENERGY_REASON_CODES.capacityMissing };
    }
    if (base.resolvedSocPct === null) {
        return { ...base, usableCapacityKwh: capacity, targetSocPct: target };
    }
    if (target === null) {
        return {
            ...base,
            usableCapacityKwh: capacity,
            targetSocPct: null,
            reasonCode: types_1.SOC_ENERGY_REASON_CODES.targetSocMissing,
            ready: false,
        };
    }
    const energy = computeEnergyFields(base.resolvedSocPct, capacity, target, profile.chargeEfficiencyPct);
    return {
        ...base,
        usableCapacityKwh: capacity,
        targetSocPct: target,
        ...energy,
        ready: true,
    };
}
function tryDirectSoc(input) {
    const { directSocPct, directSocStale, vehicleId, profile } = input;
    if (directSocPct === null || directSocPct === undefined) {
        return null;
    }
    if (!isValidDirectSocPct(directSocPct)) {
        return null;
    }
    if (directSocStale && input.directSocFromConfiguredState) {
        return null;
    }
    const base = {
        vehicleId,
        resolvedSocPct: directSocPct,
        socSource: "direct",
        socQuality: "high",
        socEstimated: false,
        usableCapacityKwh: null,
        currentBatteryEnergyKwh: null,
        targetBatteryEnergyKwh: null,
        requiredBatteryEnergyKwh: null,
        requiredInputEnergyKwh: null,
        targetSocPct: null,
        ready: false,
        reasonCode: types_1.SOC_ENERGY_REASON_CODES.directSocValid,
        baselineValid: true,
    };
    return attachEnergy(base, profile);
}
function tryEnergyRollforward(input) {
    const { rollforwardAnchor, profile, sessionEnergyKwh, sessionEnergyStale, vehicleId } = input;
    if (!rollforwardAnchor || rollforwardAnchor.vehicleId !== vehicleId) {
        return null;
    }
    if (rollforwardAnchor.rootSource !== "direct") {
        return null;
    }
    const capacity = usableCapacity(profile);
    if (capacity === null)
        return null;
    if (profile.chargeEfficiencyPct === null || profile.chargeEfficiencyPct <= 0)
        return null;
    if (sessionEnergyKwh === null)
        return null;
    if (sessionEnergyStale)
        return null;
    if (rollforwardAnchor.sessionEnergyKwh !== null &&
        sessionEnergyKwh < rollforwardAnchor.sessionEnergyKwh) {
        return null;
    }
    const deltaKwh = rollforwardAnchor.sessionEnergyKwh === null
        ? 0
        : Math.max(0, sessionEnergyKwh - rollforwardAnchor.sessionEnergyKwh);
    const baselineEnergyKwh = (capacity * rollforwardAnchor.socPct) / 100;
    const addedBatteryEnergyKwh = (deltaKwh * profile.chargeEfficiencyPct) / 100;
    const estimatedCurrentEnergyKwh = clamp(baselineEnergyKwh + addedBatteryEnergyKwh, 0, capacity);
    const estimatedSocPct = clamp((estimatedCurrentEnergyKwh / capacity) * 100, 0, 100);
    const base = {
        vehicleId,
        resolvedSocPct: estimatedSocPct,
        socSource: "energy_rollforward",
        socQuality: "medium",
        socEstimated: true,
        usableCapacityKwh: null,
        currentBatteryEnergyKwh: null,
        targetBatteryEnergyKwh: null,
        requiredBatteryEnergyKwh: null,
        requiredInputEnergyKwh: null,
        targetSocPct: null,
        ready: false,
        reasonCode: types_1.SOC_ENERGY_REASON_CODES.energyRollforwardValid,
        baselineValid: true,
    };
    return attachEnergy(base, profile);
}
function tryRangeEstimate(input) {
    const { rangeKm, rangeStale, profile, vehicleId } = input;
    if (rangeKm === null)
        return null;
    if (!Number.isFinite(rangeKm) || rangeKm < 0)
        return null;
    if (rangeStale)
        return null;
    const ref = profile.referenceRangeAt100PctKm;
    if (ref === null || !Number.isFinite(ref) || ref <= 0)
        return null;
    const estimatedSocPct = clamp((rangeKm / ref) * 100, 0, 100);
    const base = {
        vehicleId,
        resolvedSocPct: estimatedSocPct,
        socSource: "range_estimate",
        socQuality: "low",
        socEstimated: true,
        usableCapacityKwh: null,
        currentBatteryEnergyKwh: null,
        targetBatteryEnergyKwh: null,
        requiredBatteryEnergyKwh: null,
        requiredInputEnergyKwh: null,
        targetSocPct: null,
        ready: false,
        reasonCode: types_1.SOC_ENERGY_REASON_CODES.rangeEstimateValid,
        baselineValid: false,
    };
    return attachEnergy(base, profile);
}
function tryLastTrusted(input) {
    const { lastTrustedSnapshot, profile, vehicleId, now } = input;
    const maxAgeMin = profile.socFallbackMaxAgeMin;
    if (maxAgeMin === null || maxAgeMin <= 0)
        return null;
    if (!lastTrustedSnapshot || lastTrustedSnapshot.vehicleId !== vehicleId)
        return null;
    const ageMin = (now.getTime() - lastTrustedSnapshot.observedAtMs) / 60_000;
    if (ageMin > maxAgeMin)
        return null;
    if (!isValidDirectSocPct(lastTrustedSnapshot.socPct))
        return null;
    const base = {
        vehicleId,
        resolvedSocPct: lastTrustedSnapshot.socPct,
        socSource: "last_trusted",
        socQuality: "low",
        socEstimated: true,
        usableCapacityKwh: null,
        currentBatteryEnergyKwh: null,
        targetBatteryEnergyKwh: null,
        requiredBatteryEnergyKwh: null,
        requiredInputEnergyKwh: null,
        targetSocPct: null,
        ready: false,
        reasonCode: types_1.SOC_ENERGY_REASON_CODES.lastTrustedValid,
        baselineValid: true,
    };
    return attachEnergy(base, profile);
}
function directSocFailureReason(input) {
    const { directSocPct, directSocStale, directSocFromConfiguredState } = input;
    if (directSocPct === null || directSocPct === undefined) {
        return types_1.SOC_ENERGY_REASON_CODES.directSocMissing;
    }
    if (!isValidDirectSocPct(directSocPct)) {
        return types_1.SOC_ENERGY_REASON_CODES.directSocInvalid;
    }
    if (directSocStale && directSocFromConfiguredState) {
        return types_1.SOC_ENERGY_REASON_CODES.directSocStale;
    }
    return types_1.SOC_ENERGY_REASON_CODES.directSocMissing;
}
function energyRollforwardFailureReason(input) {
    const { rollforwardAnchor, profile, sessionEnergyKwh, sessionEnergyStale, vehicleId } = input;
    if (!rollforwardAnchor || rollforwardAnchor.vehicleId !== vehicleId) {
        return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardNoDirectAnchor;
    }
    if (rollforwardAnchor.rootSource !== "direct") {
        return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardBaselineSourceInvalid;
    }
    if (usableCapacity(profile) === null) {
        return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardNoCapacity;
    }
    if (profile.chargeEfficiencyPct === null || profile.chargeEfficiencyPct <= 0) {
        return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardNoEfficiency;
    }
    if (sessionEnergyKwh === null) {
        return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardCounterMissing;
    }
    if (sessionEnergyStale) {
        return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardCounterStale;
    }
    if (rollforwardAnchor.sessionEnergyKwh !== null &&
        sessionEnergyKwh < rollforwardAnchor.sessionEnergyKwh) {
        return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardCounterReset;
    }
    return types_1.SOC_ENERGY_REASON_CODES.energyRollforwardNoDirectAnchor;
}
function rangeFailureReason(input) {
    const { rangeKm, rangeStale, profile } = input;
    if (rangeKm === null)
        return types_1.SOC_ENERGY_REASON_CODES.rangeMissing;
    if (!Number.isFinite(rangeKm) || rangeKm < 0)
        return types_1.SOC_ENERGY_REASON_CODES.rangeInvalid;
    if (rangeStale)
        return types_1.SOC_ENERGY_REASON_CODES.rangeStale;
    if (profile.referenceRangeAt100PctKm === null || profile.referenceRangeAt100PctKm <= 0) {
        return types_1.SOC_ENERGY_REASON_CODES.referenceRangeMissing;
    }
    return types_1.SOC_ENERGY_REASON_CODES.rangeMissing;
}
function lastTrustedFailureReason(input) {
    const maxAgeMin = input.profile.socFallbackMaxAgeMin;
    if (maxAgeMin === null || maxAgeMin <= 0) {
        return types_1.SOC_ENERGY_REASON_CODES.lastTrustedDisabled;
    }
    const { lastTrustedSnapshot, vehicleId, now } = input;
    if (!lastTrustedSnapshot || lastTrustedSnapshot.vehicleId !== vehicleId) {
        return types_1.SOC_ENERGY_REASON_CODES.lastTrustedExpired;
    }
    const ageMin = (now.getTime() - lastTrustedSnapshot.observedAtMs) / 60_000;
    if (ageMin > maxAgeMin)
        return types_1.SOC_ENERGY_REASON_CODES.lastTrustedExpired;
    return types_1.SOC_ENERGY_REASON_CODES.lastTrustedExpired;
}
/** Pure SOC/energy resolver — no IO. */
function resolveVehicleSocAndEnergy(input) {
    const { vehicleId, profile } = input;
    const direct = tryDirectSoc(input);
    if (direct)
        return direct;
    const rollforward = tryEnergyRollforward(input);
    if (rollforward)
        return rollforward;
    const range = tryRangeEstimate(input);
    if (range)
        return range;
    const lastTrusted = tryLastTrusted(input);
    if (lastTrusted)
        return lastTrusted;
    let reasonCode = types_1.SOC_ENERGY_REASON_CODES.noUsableSocSource;
    const directReason = directSocFailureReason(input);
    if (directReason !== types_1.SOC_ENERGY_REASON_CODES.directSocMissing) {
        reasonCode = directReason;
    }
    else if (input.rollforwardAnchor && input.sessionEnergyKwh !== null) {
        reasonCode = energyRollforwardFailureReason(input);
    }
    else if (input.rangeKm !== null) {
        reasonCode = rangeFailureReason(input);
    }
    else if (input.profile.socFallbackMaxAgeMin !== null && input.profile.socFallbackMaxAgeMin > 0) {
        reasonCode = lastTrustedFailureReason(input);
    }
    return emptyResolution(vehicleId, reasonCode);
}
exports.resolveVehicleSocAndEnergy = resolveVehicleSocAndEnergy;
function buildSocEnergyInput(vehicleId, profile, telemetry, readings, rollforwardAnchor, lastTrustedSnapshot, now) {
    const nowMs = now.getTime();
    const directSocStale = readings.socFromConfiguredState &&
        (readings.stale || (0, soc_1.isFieldStale)(readings.socTs, nowMs));
    return {
        vehicleId,
        profile,
        directSocPct: telemetry.socPct,
        directSocStale,
        directSocFromConfiguredState: readings.socFromConfiguredState,
        rangeKm: telemetry.rangeKm,
        rangeStale: (0, soc_1.isFieldStale)(readings.rangeTs, nowMs),
        sessionEnergyKwh: telemetry.sessionEnergyKwh,
        sessionEnergyStale: (0, soc_1.isFieldStale)(readings.sessionEnergyTs, nowMs),
        rollforwardAnchor,
        lastTrustedSnapshot,
        now,
    };
}
exports.buildSocEnergyInput = buildSocEnergyInput;
function roundPublishedEnergyKwh(value) {
    if (value === null || !Number.isFinite(value))
        return "";
    return Math.round(value * 1000) / 1000;
}
exports.roundPublishedEnergyKwh = roundPublishedEnergyKwh;
function roundPublishedSocPct(value) {
    if (value === null || !Number.isFinite(value))
        return "";
    return Math.round(value * 10) / 10;
}
exports.roundPublishedSocPct = roundPublishedSocPct;
