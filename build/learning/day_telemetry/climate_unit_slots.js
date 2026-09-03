"use strict";
/**
 * Climate-Slot- und Mode-Hilfen für Day-Telemetry.
 * Keine erfundenen Werte, keine operative Steuerung.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.climateOverrideActive = exports.climateSlotDemandUrgency01 = exports.normalizeClimateModePurpose = void 0;
const hard_off_worth_it_1 = require("../../addons/air_conditioning/runtime/hard_off_worth_it");
function normalizeClimateModePurpose(raw) {
    const s = (raw ?? "").trim().toLowerCase();
    if (!s || s === "off" || s === "none" || s === "idle")
        return "off";
    if (s === "cooling" || s === "cool")
        return "cooling";
    if (s === "heating" || s === "heat")
        return "heating";
    if (s === "dehumidify" || s === "dry" || s === "dehumidification")
        return "dehumidify";
    return "unknown";
}
exports.normalizeClimateModePurpose = normalizeClimateModePurpose;
/**
 * Dringlichkeit nur wenn die zugrunde liegenden Sensorwerte da sind.
 * coolingDemandUrgency01 liefert bei fehlender Raumtemperatur 0 — das wäre hier erfunden.
 */
function climateSlotDemandUrgency01(input) {
    if (input.modePurpose === "cooling") {
        if (input.roomTempC == null || input.coolingOnTempC == null)
            return null;
        return (0, hard_off_worth_it_1.coolingDemandUrgency01)(input.roomTempC, input.coolingOnTempC);
    }
    if (input.modePurpose === "dehumidify") {
        if (input.roomHumidityPct == null || input.maxHumidityPct == null)
            return null;
        return (0, hard_off_worth_it_1.dehumidifyDemandUrgency01)(input.roomHumidityPct, input.maxHumidityPct);
    }
    return null;
}
exports.climateSlotDemandUrgency01 = climateSlotDemandUrgency01;
function climateOverrideActive(owner, overrideUntilIso, nowMs) {
    if (owner == null && overrideUntilIso == null)
        return null;
    if (owner === "user" || owner === "external")
        return true;
    if (overrideUntilIso) {
        const until = Date.parse(overrideUntilIso);
        if (Number.isFinite(until) && until > nowMs)
            return true;
    }
    return false;
}
exports.climateOverrideActive = climateOverrideActive;
