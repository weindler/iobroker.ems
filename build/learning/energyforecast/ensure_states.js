"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureEnergyforecastStates = ensureEnergyforecastStates;
const state_util_1 = require("../../ems_light/state_util");
function str(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function num(id, name, unit) {
    return { id, common: { name, type: "number", role: "value", read: true, write: false, unit } };
}
async function ensureEnergyforecastStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.energyforecast", "EMS-Light Energyforecast (Strompreis-Prognose)");
    await (0, state_util_1.ensureStates)(host, [
        str("learning.energyforecast.status", "Energyforecast Status (disabled|no_token|ok|error)", "disabled"),
        str("learning.energyforecast.status_de", "Energyforecast Hinweis"),
        str("learning.energyforecast.plan", "Energyforecast Tarif laut Antwort"),
        num("learning.energyforecast.days_ahead", "Energyforecast volle Tage nach heute", "d"),
        num("learning.energyforecast.price_now", "Energyforecast Gesamtpreis aktuelle Viertelstunde", "ct/kWh"),
        str("learning.energyforecast.compare_json", "Energyforecast Prognose gegen echte Preise (JSON)"),
    ]);
}
