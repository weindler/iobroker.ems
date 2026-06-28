"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeTelemetry = exports.normalizeBatteryPower = exports.DEFAULT_TELEMETRY_MAX_AGE_MS = void 0;
const capacity_1 = require("./capacity");
/** Maximal zulässiges Telemetriealter (ms), bevor Werte als stale gelten. */
exports.DEFAULT_TELEMETRY_MAX_AGE_MS = 120_000;
function validNum(v) {
    return typeof v === "number" && Number.isFinite(v);
}
/**
 * EMS-Normalisierung: positive Leistung = Laden, negative = Entladen.
 * Getrennte Lade-/Entladeleistung sind normalisiert immer >= 0.
 */
function normalizeBatteryPower(powerW, signConvention) {
    if (!validNum(powerW)) {
        return { powerW: null, chargingPowerW: null, dischargingPowerW: null };
    }
    const normalized = signConvention === "positive_discharge" ? -powerW : powerW;
    const charging = normalized > 0 ? normalized : 0;
    const discharging = normalized < 0 ? -normalized : 0;
    return { powerW: normalized, chargingPowerW: charging, dischargingPowerW: discharging };
}
exports.normalizeBatteryPower = normalizeBatteryPower;
function normalizeTelemetry(input) {
    const { reading, signConvention, nowMs } = input;
    const maxAgeMs = input.maxAgeMs ?? exports.DEFAULT_TELEMETRY_MAX_AGE_MS;
    const required = input.requiredValues ?? [];
    const power = normalizeBatteryPower(reading.powerW, signConvention);
    // Getrennte Hersteller-Lade-/Entladewerte haben Vorrang, falls vorhanden.
    const chargingPowerW = validNum(reading.chargingPowerW)
        ? Math.abs(reading.chargingPowerW)
        : power.chargingPowerW;
    const dischargingPowerW = validNum(reading.dischargingPowerW)
        ? Math.abs(reading.dischargingPowerW)
        : power.dischargingPowerW;
    const socValid = validNum(reading.socPct) && reading.socPct >= 0 && reading.socPct <= 100;
    const powerValid = power.powerW !== null;
    const capacityValid = (0, capacity_1.isValidCapacityKwh)(reading.capacityNetKwh);
    const modeValid = reading.operatingMode !== "unknown";
    const ageMs = reading.updatedAtMs !== null ? nowMs - reading.updatedAtMs : null;
    const stale = ageMs === null ? true : ageMs > maxAgeMs;
    const missingRequiredValues = [];
    if (required.includes("soc") && !socValid)
        missingRequiredValues.push("soc");
    if (required.includes("power") && !powerValid)
        missingRequiredValues.push("power");
    if (required.includes("capacity") && !capacityValid)
        missingRequiredValues.push("capacity");
    if (required.includes("mode") && !modeValid)
        missingRequiredValues.push("mode");
    const valid = socValid || powerValid;
    const telemetry = {
        socPct: socValid ? reading.socPct : null,
        powerW: power.powerW,
        chargingPowerW,
        dischargingPowerW,
        capacityNetKwh: capacityValid ? reading.capacityNetKwh : null,
        operatingMode: reading.operatingMode,
        online: reading.online,
        updatedAt: reading.updatedAtMs !== null ? new Date(reading.updatedAtMs).toISOString() : null,
        valid,
        stale,
    };
    const quality = {
        socValid,
        powerValid,
        capacityValid,
        modeValid,
        stale,
        lastValidTelemetryAt: valid && !stale ? telemetry.updatedAt : null,
        missingRequiredValues,
    };
    return { telemetry, quality };
}
exports.normalizeTelemetry = normalizeTelemetry;
