"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWeatherHorizon = void 0;
const config_1 = require("./config");
const constants_1 = require("./constants");
const ensure_states_1 = require("./ensure_states");
async function readForeignNum(host, id) {
    if (!id)
        return null;
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        const st = await reader(id);
        const n = typeof st?.val === "number" ? st.val : Number(st?.val);
        return Number.isFinite(n) ? n : null;
    }
    catch {
        return null;
    }
}
async function setNumOrClear(host, id, value) {
    if (value !== null && Number.isFinite(value)) {
        await host.setStateAsync(id, { val: Math.round(value * 100) / 100, ack: true });
    }
    else {
        await host.setStateAsync(id, { val: null, ack: true });
    }
}
function dayQuality(min, max, mapped) {
    if (!mapped)
        return "missing";
    if (min !== null && max !== null)
        return "valid";
    if (min !== null || max !== null)
        return "degraded";
    return "missing";
}
/**
 * Copy Admin-mapped foreign daily min/max temps into learning.weather.horizon.day{3-7}.*
 * Unmapped or unreadable → null / quality missing — never invent 0.
 */
async function runWeatherHorizon(host) {
    const cfg = (0, config_1.weatherHorizonConfigFromAdapter)(host.config);
    if (!cfg.enabled) {
        await host.setStateAsync("learning.weather.horizon.status", { val: "disabled", ack: true });
        return;
    }
    if (!(0, config_1.weatherHorizonHasAnyMapping)(cfg)) {
        await host.setStateAsync("learning.weather.horizon.status", { val: "no_mapping", ack: true });
        await host.setStateAsync("learning.weather.horizon.days_available", { val: 0, ack: true });
        for (const day of constants_1.WEATHER_HORIZON_DAY_INDEXES) {
            const prefix = (0, ensure_states_1.weatherHorizonDayStatePrefix)(day);
            await setNumOrClear(host, `${prefix}.min_temp_c`, null);
            await setNumOrClear(host, `${prefix}.max_temp_c`, null);
            await host.setStateAsync(`${prefix}.quality`, { val: "missing", ack: true });
        }
        return;
    }
    let available = 0;
    for (const dayCfg of cfg.days) {
        const mapped = Boolean(dayCfg.minTempStateId || dayCfg.maxTempStateId);
        const min = dayCfg.minTempStateId ? await readForeignNum(host, dayCfg.minTempStateId) : null;
        const max = dayCfg.maxTempStateId ? await readForeignNum(host, dayCfg.maxTempStateId) : null;
        const quality = dayQuality(min, max, mapped);
        if (quality === "valid" || quality === "degraded") {
            available += 1;
        }
        const prefix = (0, ensure_states_1.weatherHorizonDayStatePrefix)(dayCfg.dayIndex);
        await setNumOrClear(host, `${prefix}.min_temp_c`, min);
        await setNumOrClear(host, `${prefix}.max_temp_c`, max);
        await host.setStateAsync(`${prefix}.quality`, { val: quality, ack: true });
    }
    const status = available > 0 ? "ready" : "no_data";
    await host.setStateAsync("learning.weather.horizon.status", { val: status, ack: true });
    await host.setStateAsync("learning.weather.horizon.days_available", { val: available, ack: true });
    await host.setStateAsync("learning.weather.horizon.last_update", {
        val: new Date().toISOString(),
        ack: true,
    });
    host.log.debug?.(`Weather-Horizon: ${available}/${constants_1.WEATHER_HORIZON_DAY_INDEXES.length} days available`);
}
exports.runWeatherHorizon = runWeatherHorizon;
