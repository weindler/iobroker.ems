"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureWeatherHorizonStates = exports.weatherHorizonDayStatePrefix = void 0;
const state_util_1 = require("../../../ems_light/state_util");
const constants_1 = require("./constants");
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
function weatherHorizonDayStatePrefix(dayIndex) {
    return `learning.weather.horizon.day${dayIndex}`;
}
exports.weatherHorizonDayStatePrefix = weatherHorizonDayStatePrefix;
async function ensureWeatherHorizonStates(host) {
    await (0, state_util_1.ensureChannel)(host, "learning.weather", "EMS-Light Learning Weather");
    await (0, state_util_1.ensureChannel)(host, "learning.weather.horizon", "EMS-Light Weather Horizon (Tag 1–7)");
    const defs = [
        strState("learning.weather.horizon.status", "Wetter-Horizon Status", "no_data"),
        strState("learning.weather.horizon.last_update", "Wetter-Horizon letztes Update (ISO)"),
        numState("learning.weather.horizon.min_bias_c", "Wetter-Horizon Min-Bias (Ist−Forecast)", "°C"),
        numState("learning.weather.horizon.max_bias_c", "Wetter-Horizon Max-Bias (Ist−Forecast)", "°C"),
        strState("learning.weather.horizon.bias_source", "Wetter-Horizon Bias-Quelle", "none"),
        strState("learning.weather.horizon.freeze_date", "Wetter-Horizon Freeze-Datum (Tag1 Forecast)"),
        numState("learning.weather.horizon.freeze_min_temp_c", "Freeze Tag1 Forecast Min", "°C"),
        numState("learning.weather.horizon.freeze_max_temp_c", "Freeze Tag1 Forecast Max", "°C"),
        strState("learning.weather.horizon.observed_date", "Beobachtetes Ist-Datum (Live)"),
        numState("learning.weather.horizon.observed_min_temp_c", "Beobachtetes Ist Min heute", "°C"),
        numState("learning.weather.horizon.observed_max_temp_c", "Beobachtetes Ist Max heute", "°C"),
    ];
    for (const day of constants_1.WEATHER_HORIZON_DAY_INDEXES) {
        const prefix = weatherHorizonDayStatePrefix(day);
        const label = day === 1 ? "heute" : day === 2 ? "morgen" : `Tag ${day}`;
        defs.push(numState(`${prefix}.min_temp_c`, `Wetter-Horizon ${label} korr. Min °C`, "°C"), numState(`${prefix}.max_temp_c`, `Wetter-Horizon ${label} korr. Max °C`, "°C"), strState(`${prefix}.quality`, `Wetter-Horizon ${label} Qualität`, "missing"));
    }
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureWeatherHorizonStates = ensureWeatherHorizonStates;
