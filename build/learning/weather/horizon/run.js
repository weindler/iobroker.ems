"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWeatherHorizon = void 0;
const state_util_1 = require("../../../ems_light/state_util");
const config_1 = require("../config");
const config_2 = require("./config");
const constants_1 = require("./constants");
const ensure_states_1 = require("./ensure_states");
const math_1 = require("./math");
async function readOwnNum(host, id) {
    try {
        const st = await host.getStateAsync(id);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
async function readOwnStr(host, id) {
    try {
        const st = await host.getStateAsync(id);
        return typeof st?.val === "string" && st.val.trim() ? st.val.trim() : null;
    }
    catch {
        return null;
    }
}
async function readForeignNum(host, id) {
    if (!id)
        return null;
    try {
        const reader = host.getForeignStateAsync ?? host.getStateAsync;
        const st = await reader(id);
        return (0, state_util_1.asNum)(st?.val);
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
function localDateKey(now = new Date()) {
    const y = now.getFullYear();
    const m = String(now.getMonth() + 1).padStart(2, "0");
    const d = String(now.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
}
/**
 * Tag-1 Forecast einfrieren und am Folgetag mit beobachtetem Ist-Min/Max vergleichen → Bias EMA.
 * Fallback: learning.weather.temp_bias_c für Min und Max, wenn noch kein Horizon-Bias.
 */
async function resolveAndUpdateBias(host, todayKey, day1RawMin, day1RawMax, liveOutdoorC) {
    const freezeDate = await readOwnStr(host, "learning.weather.horizon.freeze_date");
    const freezeMin = await readOwnNum(host, "learning.weather.horizon.freeze_min_temp_c");
    const freezeMax = await readOwnNum(host, "learning.weather.horizon.freeze_max_temp_c");
    const observedDate = await readOwnStr(host, "learning.weather.horizon.observed_date");
    let observedMin = await readOwnNum(host, "learning.weather.horizon.observed_min_temp_c");
    let observedMax = await readOwnNum(host, "learning.weather.horizon.observed_max_temp_c");
    let minBias = await readOwnNum(host, "learning.weather.horizon.min_bias_c");
    let maxBias = await readOwnNum(host, "learning.weather.horizon.max_bias_c");
    let biasSource = (await readOwnStr(host, "learning.weather.horizon.bias_source")) || "none";
    // Tageswechsel: Freeze vs. beobachtetes Ist desselben Freeze-Tages → Bias lernen
    if (freezeDate &&
        freezeDate < todayKey &&
        observedDate === freezeDate &&
        ((freezeMin !== null && observedMin !== null) || (freezeMax !== null && observedMax !== null))) {
        if (freezeMin !== null && observedMin !== null) {
            minBias = (0, math_1.emaBiasC)(minBias, (0, math_1.dailyTempBiasSample)(observedMin, freezeMin));
        }
        if (freezeMax !== null && observedMax !== null) {
            maxBias = (0, math_1.emaBiasC)(maxBias, (0, math_1.dailyTempBiasSample)(observedMax, freezeMax));
        }
        biasSource = "day1_freeze_vs_observed";
        await setNumOrClear(host, "learning.weather.horizon.min_bias_c", minBias);
        await setNumOrClear(host, "learning.weather.horizon.max_bias_c", maxBias);
        await host.setStateAsync("learning.weather.horizon.bias_source", { val: biasSource, ack: true });
        host.log.info(`Weather-Horizon bias updated from ${freezeDate}: min=${minBias ?? "n/a"} max=${maxBias ?? "n/a"}`);
    }
    // Live-Ist Min/Max für heute fortgeschrieben (für morgen Lernen)
    if (liveOutdoorC !== null && Number.isFinite(liveOutdoorC)) {
        if (observedDate !== todayKey) {
            observedMin = liveOutdoorC;
            observedMax = liveOutdoorC;
            await host.setStateAsync("learning.weather.horizon.observed_date", { val: todayKey, ack: true });
        }
        else {
            observedMin = observedMin === null ? liveOutdoorC : Math.min(observedMin, liveOutdoorC);
            observedMax = observedMax === null ? liveOutdoorC : Math.max(observedMax, liveOutdoorC);
        }
        await setNumOrClear(host, "learning.weather.horizon.observed_min_temp_c", observedMin);
        await setNumOrClear(host, "learning.weather.horizon.observed_max_temp_c", observedMax);
    }
    // Tag-1 Forecast einmal pro Kalendertag einfrieren
    if (freezeDate !== todayKey && (day1RawMin !== null || day1RawMax !== null)) {
        await host.setStateAsync("learning.weather.horizon.freeze_date", { val: todayKey, ack: true });
        await setNumOrClear(host, "learning.weather.horizon.freeze_min_temp_c", day1RawMin);
        await setNumOrClear(host, "learning.weather.horizon.freeze_max_temp_c", day1RawMax);
    }
    // Fallback: allgemeiner Temp-Bias aus Weather-Learning
    if (minBias === null && maxBias === null) {
        const legacy = await readOwnNum(host, "learning.weather.temp_bias_c");
        if (legacy !== null) {
            minBias = legacy;
            maxBias = legacy;
            biasSource = "learning.weather.temp_bias_c";
            await setNumOrClear(host, "learning.weather.horizon.min_bias_c", minBias);
            await setNumOrClear(host, "learning.weather.horizon.max_bias_c", maxBias);
            await host.setStateAsync("learning.weather.horizon.bias_source", { val: biasSource, ack: true });
        }
    }
    return { minBiasC: minBias, maxBiasC: maxBias, biasSource };
}
/**
 * BrightSky (o. ä.) Tages-Min/Max Tag 1–7 → raw + bias-korrigiert.
 * Unmapped/unlesbar → null / quality missing — nie Fake-0.
 */
async function runWeatherHorizon(host) {
    const cfg = (0, config_2.weatherHorizonConfigFromAdapter)(host.config);
    if (!cfg.enabled) {
        await host.setStateAsync("learning.weather.horizon.status", { val: "disabled", ack: true });
        return;
    }
    if (!(0, config_2.weatherHorizonHasAnyMapping)(cfg)) {
        await host.setStateAsync("learning.weather.horizon.status", { val: "no_mapping", ack: true });
        for (const day of constants_1.WEATHER_HORIZON_DAY_INDEXES) {
            const prefix = (0, ensure_states_1.weatherHorizonDayStatePrefix)(day);
            await setNumOrClear(host, `${prefix}.min_temp_c`, null);
            await setNumOrClear(host, `${prefix}.max_temp_c`, null);
            await host.setStateAsync(`${prefix}.quality`, { val: "missing", ack: true });
        }
        return;
    }
    const weatherCfg = (0, config_1.weatherConfigFromAdapter)(host.config);
    const tempActualId = weatherCfg.metrics.temp?.actualStateId ?? "";
    const liveOutdoorC = tempActualId ? await readForeignNum(host, tempActualId) : null;
    const rawByDay = new Map();
    for (const dayCfg of cfg.days) {
        const mapped = Boolean(dayCfg.minTempStateId || dayCfg.maxTempStateId);
        const min = dayCfg.minTempStateId ? await readForeignNum(host, dayCfg.minTempStateId) : null;
        const max = dayCfg.maxTempStateId ? await readForeignNum(host, dayCfg.maxTempStateId) : null;
        rawByDay.set(dayCfg.dayIndex, { min, max, mapped });
    }
    const day1 = rawByDay.get(1) ?? { min: null, max: null, mapped: false };
    const todayKey = localDateKey();
    const { minBiasC, maxBiasC } = await resolveAndUpdateBias(host, todayKey, day1.min, day1.max, liveOutdoorC);
    let available = 0;
    for (const day of constants_1.WEATHER_HORIZON_DAY_INDEXES) {
        const raw = rawByDay.get(day) ?? { min: null, max: null, mapped: false };
        const corrMin = (0, math_1.correctHorizonTempC)(raw.min, minBiasC, day);
        const corrMax = (0, math_1.correctHorizonTempC)(raw.max, maxBiasC, day);
        const quality = dayQuality(corrMin, corrMax, raw.mapped);
        if (quality === "valid" || quality === "degraded") {
            available += 1;
        }
        const prefix = (0, ensure_states_1.weatherHorizonDayStatePrefix)(day);
        await setNumOrClear(host, `${prefix}.min_temp_c`, corrMin);
        await setNumOrClear(host, `${prefix}.max_temp_c`, corrMax);
        await host.setStateAsync(`${prefix}.quality`, { val: quality, ack: true });
    }
    const status = available > 0 ? (minBiasC !== null || maxBiasC !== null ? "ready" : "no_bias") : "no_data";
    await host.setStateAsync("learning.weather.horizon.status", { val: status, ack: true });
    await host.setStateAsync("learning.weather.horizon.last_update", {
        val: new Date().toISOString(),
        ack: true,
    });
    host.log.debug?.(`Weather-Horizon: ${available}/${constants_1.WEATHER_HORIZON_DAY_INDEXES.length} days (bias min=${minBiasC ?? "n/a"} max=${maxBiasC ?? "n/a"})`);
}
exports.runWeatherHorizon = runWeatherHorizon;
