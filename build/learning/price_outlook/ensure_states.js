"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensurePriceOutlookStates = void 0;
const state_util_1 = require("../../ems_light/state_util");
function state(id, name, type, unit, def) {
    return {
        id,
        common: { name, type, role: type === "number" ? "value" : "text", read: true, write: false, unit, def },
        defaultVal: def,
        setDefaultIfEmpty: def !== undefined,
    };
}
async function ensurePriceOutlookStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.price_outlook", "Sieben-Tage-Preisprognose");
    await (0, state_util_1.ensureStates)(host, [
        state("learning.price_outlook.status", "Preisprognose Status", "string", undefined, "waiting"),
        state("learning.price_outlook.status_de", "Preisprognose Status", "string", undefined, "Wartet auf den ersten Prognoselauf."),
        state("learning.price_outlook.last_update", "Preisprognose letzte Aktualisierung", "string"),
        state("learning.price_outlook.horizon_json", "Preisprognose sieben Tage JSON", "string"),
        state("learning.price_outlook.spread_ct_per_kwh", "Gelernter Tibber-Aufschlag", "number", "ct/kWh"),
        state("learning.price_outlook.spread_confidence_pct", "Confidence Tibber-Aufschlag", "number", "%"),
        state("learning.price_outlook.error", "Preisprognose Fehler", "string", undefined, ""),
        state("learning.price_outlook.local_pv_raw_json", "Lokale Bright-Sky-PV-Rohprognose", "string"),
        ...Array.from({ length: 7 }, (_, index) => state(`learning.price_outlook.local_pv_day${index + 1}_raw_kwh`, `Lokale PV-Rohprognose Tag ${index + 1}`, "number", "kWh")),
    ]);
}
exports.ensurePriceOutlookStates = ensurePriceOutlookStates;
