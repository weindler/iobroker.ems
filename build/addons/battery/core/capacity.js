"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveEnergy = exports.resolveCapacity = exports.isValidCapacityKwh = void 0;
/** Ungültig: null, NaN, Infinity, <= 0. */
function isValidCapacityKwh(value) {
    return typeof value === "number" && Number.isFinite(value) && value > 0;
}
exports.isValidCapacityKwh = isValidCapacityKwh;
/**
 * Priorität:
 * 1. gültiger gemappter Wert, wenn Mapping-Quelle gewählt
 * 2. gültiger manueller Wert
 * 3. unknown
 * Ein ungültiger Wert wird niemals verwendet (und nie als 0 kWh behandelt).
 */
function resolveCapacity(inputs) {
    const manual = isValidCapacityKwh(inputs.manualKwh) ? inputs.manualKwh : null;
    const mapped = isValidCapacityKwh(inputs.mappedKwh) ? inputs.mappedKwh : null;
    if (inputs.source === "mapped" && mapped !== null) {
        return { manualKwh: manual, mappedKwh: mapped, effectiveKwh: mapped, source: "mapped", valid: true };
    }
    if (manual !== null) {
        return { manualKwh: manual, mappedKwh: mapped, effectiveKwh: manual, source: "manual", valid: true };
    }
    return { manualKwh: manual, mappedKwh: mapped, effectiveKwh: null, source: "unknown", valid: false };
}
exports.resolveCapacity = resolveCapacity;
/** Energieableitungen nur bei gültigem SOC und gültiger Kapazität. */
function deriveEnergy(socPct, capacityNetKwh, minSocPct) {
    const empty = {
        energyStoredKwh: null,
        energyFreeToFullKwh: null,
        energyAboveTechnicalMinKwh: null,
    };
    if (socPct === null ||
        !Number.isFinite(socPct) ||
        socPct < 0 ||
        socPct > 100 ||
        !isValidCapacityKwh(capacityNetKwh)) {
        return empty;
    }
    const stored = (socPct / 100) * capacityNetKwh;
    const free = capacityNetKwh - stored;
    let aboveMin = null;
    if (minSocPct !== null && Number.isFinite(minSocPct) && minSocPct >= 0 && minSocPct <= 100) {
        aboveMin = Math.max(0, ((socPct - minSocPct) / 100) * capacityNetKwh);
    }
    return {
        energyStoredKwh: round3(stored),
        energyFreeToFullKwh: round3(Math.max(0, free)),
        energyAboveTechnicalMinKwh: aboveMin === null ? null : round3(aboveMin),
    };
}
exports.deriveEnergy = deriveEnergy;
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
