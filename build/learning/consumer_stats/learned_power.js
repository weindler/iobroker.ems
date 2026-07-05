"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveConsumerEffectivePowerW = exports.collectRecentDayMetrics = exports.LEARNED_POWER_MIN_SAMPLE_DAYS = exports.LEARNED_POWER_LOOKBACK_DAYS = exports.LEARNED_POWER_MIN_DAY_RUNTIME_SEC = void 0;
const constants_1 = require("../house_load/constants");
const day_1 = require("../energy_daily_rollup/day");
exports.LEARNED_POWER_MIN_DAY_RUNTIME_SEC = 600;
exports.LEARNED_POWER_LOOKBACK_DAYS = 60;
exports.LEARNED_POWER_MIN_SAMPLE_DAYS = 3;
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}
function dayEffectivePowerW(runtimeSec, energyKwh) {
    if (runtimeSec < exports.LEARNED_POWER_MIN_DAY_RUNTIME_SEC || energyKwh <= 0) {
        return null;
    }
    const hours = runtimeSec / 3600;
    if (hours <= 0)
        return null;
    const w = (energyKwh * 1000) / hours;
    return Number.isFinite(w) && w > 0 ? w : null;
}
function collectRecentDayMetrics(entry, nowMs, lookbackDays = exports.LEARNED_POWER_LOOKBACK_DAYS) {
    if (!entry?.days) {
        return { powerWs: [], runtimeSecs: [] };
    }
    const cutoff = nowMs - lookbackDays * constants_1.MS_PER_DAY;
    const powerWs = [];
    const runtimeSecs = [];
    for (const [dateKey, day] of Object.entries(entry.days)) {
        if ((0, day_1.dateKeyToStartMs)(dateKey) < cutoff) {
            continue;
        }
        if (day.runtimeSec < exports.LEARNED_POWER_MIN_DAY_RUNTIME_SEC) {
            continue;
        }
        runtimeSecs.push(day.runtimeSec);
        const w = dayEffectivePowerW(day.runtimeSec, day.energyKwh);
        if (w !== null) {
            powerWs.push(w);
        }
    }
    return { powerWs, runtimeSecs };
}
exports.collectRecentDayMetrics = collectRecentDayMetrics;
/** Effektive Leistung: Median aus Stats-Tageswerten, sonst Admin-Config. */
function resolveConsumerEffectivePowerW(entry, configPowerW, nowMs) {
    const safeConfig = configPowerW > 0 ? configPowerW : 0;
    const { powerWs, runtimeSecs } = collectRecentDayMetrics(entry, nowMs);
    const sampleDays = powerWs.length;
    const medianPower = median(powerWs);
    const medianRuntimeSecPerDay = median(runtimeSecs);
    if (sampleDays >= exports.LEARNED_POWER_MIN_SAMPLE_DAYS && medianPower !== null && medianPower > 0) {
        return {
            powerW: Math.round(medianPower),
            source: "learned",
            sampleDays,
            medianRuntimeSecPerDay,
        };
    }
    return {
        powerW: safeConfig,
        source: "config",
        sampleDays,
        medianRuntimeSecPerDay,
    };
}
exports.resolveConsumerEffectivePowerW = resolveConsumerEffectivePowerW;
