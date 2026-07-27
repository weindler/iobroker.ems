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
    await (0, state_util_1.ensureChannel)(host, "learning.weather.horizon", "EMS-Light Weather Horizon (Tag 3–7)");
    const defs = [
        strState("learning.weather.horizon.status", "Wetter-Horizon Status", "no_data"),
        numState("learning.weather.horizon.days_available", "Wetter-Horizon verfügbare Tage"),
        strState("learning.weather.horizon.last_update", "Wetter-Horizon letztes Update (ISO)"),
    ];
    for (const day of constants_1.WEATHER_HORIZON_DAY_INDEXES) {
        const prefix = weatherHorizonDayStatePrefix(day);
        defs.push(numState(`${prefix}.min_temp_c`, `Wetter-Horizon Tag ${day} Min °C`, "°C"), numState(`${prefix}.max_temp_c`, `Wetter-Horizon Tag ${day} Max °C`, "°C"), strState(`${prefix}.quality`, `Wetter-Horizon Tag ${day} Qualität`, "missing"));
    }
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensureWeatherHorizonStates = ensureWeatherHorizonStates;
