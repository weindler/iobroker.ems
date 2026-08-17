"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWeatherLearningStates = void 0;
const state_util_1 = require("../../ems_light/state_util");
function numState(id, name, unit) {
    return {
        id,
        common: {
            name,
            type: "number",
            role: "value",
            read: true,
            write: false,
            unit,
        },
    };
}
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensureWeatherLearningStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.weather", "EMS-Light Learning Weather");
    const defs = [
        strState("learning.weather.status", "Weather-Learning Status", "not_initialized"),
        strState("learning.weather.health", "Weather-Learning Health", "error"),
        strState("learning.weather.last_update", "Weather-Learning letztes Update (ISO)"),
        numState("learning.weather.temp_bias_c", "Wetter Temp-Bias", "°C"),
        numState("learning.weather.confidence_pct", "Weather-Learning Confidence", "%"),
        numState("learning.weather.sample_days_30d", "Weather-Learning gültige Tage 30d"),
        strState("learning.weather.error", "Weather-Learning Fehler"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureWeatherLearningStates = ensureWeatherLearningStates;
