"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureMeasuredConsumersStates = exports.ensureMeasuredConsumerSlotStates = exports.ensureMeasuredConsumersAggregateStates = void 0;
const state_util_1 = require("../../../ems_light/state_util");
const state_ids_1 = require("./state_ids");
function strState(id, name, def = "") {
    return { id, common: { name, type: "string", role: "text", read: true, write: false, def }, defaultVal: def };
}
function numState(id, name, unit) {
    return { id, common: { name, type: "number", role: "value", read: true, write: false, unit } };
}
function boolState(id, name, def = false) {
    return { id, common: { name, type: "boolean", role: "indicator", read: true, write: false, def }, defaultVal: def };
}
/** Aggregat-States existieren immer (unabhängig von der Anzahl konfigurierter Zeilen). */
async function ensureMeasuredConsumersAggregateStates(host) {
    await (0, state_util_1.ensureChannel)(host, state_ids_1.MEASURED_CONSUMERS_BASE, "Gemessene Verbraucher");
    const s = state_ids_1.MEASURED_CONSUMERS_AGGREGATE_STATES;
    await (0, state_util_1.ensureStates)(host, [
        numState(s.totalPowerW, "Gesamtleistung gemessener Verbraucher", "W"),
        numState(s.totalEnergyTodayKwh, "Energie heute (gemessene Verbraucher gesamt)", "kWh"),
        numState(s.totalEnergyYesterdayKwh, "Energie gestern (gemessene Verbraucher gesamt)", "kWh"),
        numState(s.totalEnergyMonthKwh, "Energie Monat (gemessene Verbraucher gesamt)", "kWh"),
        numState(s.totalEnergyYearKwh, "Energie Jahr (gemessene Verbraucher gesamt)", "kWh"),
        numState(s.totalEnergyTotalKwh, "Energie gesamt (gemessene Verbraucher gesamt)", "kWh"),
        numState(s.unknownHouseLoadW, "Unbekannte Restlast (Hauslast minus gemessene Verbraucher)", "W"),
        numState(s.houseLoadW, "Hauslast zum Vergleich (nur Anzeige, unverändert)", "W"),
        boolState(s.houseLoadAvailable, "Hauslast verfügbar", false),
        numState(s.activeSlotCount, "Anzahl aktiver gemessener Verbraucher"),
        strState(s.consumersJson, "Verbraucher-Liste (JSON, für künftige Charts)", "[]"),
        strState(s.lastTickIso, "Letzter Verarbeitungszeitpunkt (ISO)", ""),
        strState(s.reasonDe, "Diagnose (gesamt)", ""),
    ]);
}
exports.ensureMeasuredConsumersAggregateStates = ensureMeasuredConsumersAggregateStates;
/** Pro-Slot-States nur für tatsächlich konfigurierte Zeilen (Admin-Tabelle) — kein 20-facher Leerlauf. */
async function ensureMeasuredConsumerSlotStates(host, slot) {
    const ids = (0, state_ids_1.measuredConsumerSlotStateIds)(slot.index);
    await (0, state_util_1.ensureChannel)(host, ids.base, `Gemessener Verbraucher ${slot.index}: ${slot.name}`);
    await (0, state_util_1.ensureStates)(host, [
        strState(ids.name, "Name", slot.name),
        boolState(ids.enabled, "Aktiv", slot.enabled),
        numState(ids.powerW, "Leistung", "W"),
        numState(ids.energyTotalKwh, "Energie gesamt", "kWh"),
        numState(ids.energyTodayKwh, "Energie heute", "kWh"),
        numState(ids.energyYesterdayKwh, "Energie gestern", "kWh"),
        numState(ids.energyMonthKwh, "Energie Monat", "kWh"),
        numState(ids.energyYearKwh, "Energie Jahr", "kWh"),
        strState(ids.sourceMode, "Quelle (energy_state/power_integration/none)", "none"),
        boolState(ids.valid, "Gültig", false),
        strState(ids.reasonDe, "Diagnose (DE)", ""),
    ]);
}
exports.ensureMeasuredConsumerSlotStates = ensureMeasuredConsumerSlotStates;
/**
 * Aggregat-Channel/States nur anlegen, wenn mindestens eine Zeile konfiguriert ist —
 * hält die States-Oberfläche bei leerer Admin-Config minimal (kein Leerlauf-Overhead).
 */
async function ensureMeasuredConsumersStates(host, slots) {
    if (slots.length === 0)
        return;
    await ensureMeasuredConsumersAggregateStates(host);
    for (const slot of slots) {
        await ensureMeasuredConsumerSlotStates(host, slot);
    }
}
exports.ensureMeasuredConsumersStates = ensureMeasuredConsumersStates;
