"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.measuredConsumerOverflowCount = exports.configuredMeasuredConsumerSlots = void 0;
const constants_1 = require("./constants");
function asStr(v) {
    if (typeof v === "string")
        return v.trim();
    if (v === null || v === undefined)
        return "";
    return String(v).trim();
}
function asBoolField(v, def) {
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    const s = asStr(v).toLowerCase();
    if (["1", "true", "on", "yes", "ja"].includes(s))
        return true;
    if (["0", "false", "off", "no", "nein"].includes(s))
        return false;
    return def;
}
function asOptionalNum(v) {
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "number" ? v : parseFloat(asStr(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
}
/**
 * Liest die Admin-Tabelle generisch als Liste (kein Sonderpfad je Zeile).
 * Zeilen über der festen Kapazität (20) werden ignoriert (Aufrufer kann warnen).
 */
function configuredMeasuredConsumerSlots(config) {
    const raw = config && typeof config === "object" ? config : {};
    const rows = Array.isArray(raw[constants_1.MEASURED_CONSUMERS_CONFIG_KEY]) ? raw[constants_1.MEASURED_CONSUMERS_CONFIG_KEY] : [];
    const out = [];
    for (const row of rows) {
        if (out.length >= constants_1.MEASURED_CONSUMERS_SLOT_COUNT)
            break;
        const r = row && typeof row === "object" ? row : {};
        const index = out.length + 1;
        const powerStateId = asStr(r.power_state_id);
        const energyStateId = asStr(r.energy_state_id);
        out.push({
            index,
            enabled: asBoolField(r.enabled, true),
            name: asStr(r.name) || `Verbraucher ${index}`,
            powerStateId: powerStateId || null,
            energyStateId: energyStateId || null,
            initialEnergyKwh: asOptionalNum(r.initial_energy_kwh),
        });
    }
    return out;
}
exports.configuredMeasuredConsumerSlots = configuredMeasuredConsumerSlots;
/** Anzahl konfigurierter Zeilen jenseits der Admin-Kapazität (für einmalige Warnung beim Start). */
function measuredConsumerOverflowCount(config) {
    const raw = config && typeof config === "object" ? config : {};
    const rows = Array.isArray(raw[constants_1.MEASURED_CONSUMERS_CONFIG_KEY]) ? raw[constants_1.MEASURED_CONSUMERS_CONFIG_KEY] : [];
    return Math.max(0, rows.length - constants_1.MEASURED_CONSUMERS_SLOT_COUNT);
}
exports.measuredConsumerOverflowCount = measuredConsumerOverflowCount;
