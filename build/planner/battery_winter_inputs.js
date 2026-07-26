"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readBatteryWinterDays = void 0;
const time_1 = require("../learning/house_load/time");
const battery_winter_1 = require("../operator/planning/battery_winter");
async function readNum(host, id) {
    try {
        const st = await host.getStateAsync(id);
        const v = st?.val;
        if (v === null || v === undefined || v === "")
            return null;
        const n = typeof v === "number" ? v : parseFloat(String(v));
        return Number.isFinite(n) ? n : null;
    }
    catch {
        return null;
    }
}
async function readStr(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (st?.val == null || String(st.val).trim() === "")
            return null;
        return String(st.val).trim();
    }
    catch {
        return null;
    }
}
function parseHouseLoadForecast(raw) {
    if (!raw)
        return null;
    try {
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
function avgLoadKwh(a, b) {
    if (a !== null && b !== null)
        return (a + b) / 2;
    return a ?? b;
}
/** Baut 7-Tage-Horizont aus PV-Bias, PV-Horizon und House-Load-Forecasts. */
async function readBatteryWinterDays(host, horizonDays) {
    const [pvToday, pvTomorrow, forecastTodayRaw, forecastTomorrowRaw, pvBiasConfidence, horizonDay3, horizonDay4, horizonDay5, horizonDay6, horizonDay7, confDay3, confDay4, confDay5, confDay6, confDay7,] = await Promise.all([
        readNum(host, "learning.pv_bias.corrected_today_kwh"),
        readNum(host, "learning.pv_bias.corrected_tomorrow_kwh"),
        readStr(host, "learning.house_load.forecast_today_json"),
        readStr(host, "learning.house_load.forecast_tomorrow_json"),
        readNum(host, "learning.pv_bias.confidence_pct"),
        readNum(host, "learning.pv_horizon.day3.corrected_kwh"),
        readNum(host, "learning.pv_horizon.day4.corrected_kwh"),
        readNum(host, "learning.pv_horizon.day5.corrected_kwh"),
        readNum(host, "learning.pv_horizon.day6.corrected_kwh"),
        readNum(host, "learning.pv_horizon.day7.corrected_kwh"),
        readNum(host, "learning.pv_horizon.day3.confidence_pct"),
        readNum(host, "learning.pv_horizon.day4.confidence_pct"),
        readNum(host, "learning.pv_horizon.day5.confidence_pct"),
        readNum(host, "learning.pv_horizon.day6.confidence_pct"),
        readNum(host, "learning.pv_horizon.day7.confidence_pct"),
    ]);
    const loadToday = (0, battery_winter_1.dailyKwhFromHouseLoadForecast)(parseHouseLoadForecast(forecastTodayRaw));
    const loadTomorrow = (0, battery_winter_1.dailyKwhFromHouseLoadForecast)(parseHouseLoadForecast(forecastTomorrowRaw));
    const loadFallback = avgLoadKwh(loadToday, loadTomorrow);
    const horizonPv = [horizonDay3, horizonDay4, horizonDay5, horizonDay6, horizonDay7];
    const horizonConf = [confDay3, confDay4, confDay5, confDay6, confDay7];
    const days = [];
    for (let i = 0; i < horizonDays; i++) {
        const ctx = (0, time_1.contextForDayOffset)(i);
        let pvKwh = null;
        let pvConfidencePct = null;
        if (i === 0) {
            pvKwh = pvToday;
            pvConfidencePct = pvBiasConfidence;
        }
        else if (i === 1) {
            pvKwh = pvTomorrow;
            pvConfidencePct = pvBiasConfidence !== null ? Math.max(0, pvBiasConfidence - 5) : null;
        }
        else {
            pvKwh = horizonPv[i - 2] ?? null;
            pvConfidencePct = horizonConf[i - 2] ?? null;
        }
        let loadKwh = null;
        if (i === 0)
            loadKwh = loadToday ?? loadFallback;
        else if (i === 1)
            loadKwh = loadTomorrow ?? loadFallback;
        else
            loadKwh = loadFallback;
        days.push({
            dayIndex: i + 1,
            dateKey: ctx.dateKey,
            pvKwh,
            loadKwh,
            pvConfidencePct,
        });
    }
    return days;
}
exports.readBatteryWinterDays = readBatteryWinterDays;
