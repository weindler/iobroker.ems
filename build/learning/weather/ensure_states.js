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
        numState("learning.weather.cloud_bias_pct", "Wetter Wolken-Bias", "%"),
        numState("learning.weather.rain_bias_mm", "Wetter Regen-Bias", "mm"),
        numState("learning.weather.wind_bias_kmh", "Wetter Wind-Bias", "km/h"),
        numState("learning.weather.confidence_pct", "Weather-Learning Confidence", "%"),
        numState("learning.weather.sample_days_7d", "Weather-Learning gültige Tage 7d"),
        numState("learning.weather.sample_days_30d", "Weather-Learning gültige Tage 30d"),
        strState("learning.weather.valid_fields", "Weather-Learning valide Felder"),
        strState("learning.weather.missing_fields", "Weather-Learning fehlende Felder"),
        strState("learning.weather.quality_level", "Weather-Learning Qualität", "none"),
        strState("learning.weather.forecast_source", "Weather-Learning Forecast-Quelle"),
        strState("learning.weather.actual_source", "Weather-Learning Ist-Quelle"),
        strState("learning.weather.summary_yesterday", "Weather-Learning Zusammenfassung gestern"),
        strState("learning.weather.error", "Weather-Learning Fehler"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureWeatherLearningStates = ensureWeatherLearningStates;
