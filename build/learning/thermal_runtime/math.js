"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.invalidConfigResult = exports.disabledResult = exports.noSourceResult = exports.computeThermalRuntimeLearning = exports.estimatedEmptyAtIso = exports.estimateRemainingHours = exports.groupByDayType = exports.groupBySeason = exports.detectRuntimeCycles = exports.median = exports.average = void 0;
const time_1 = require("../house_load/time");
const constants_1 = require("./constants");
function round2(n) {
    return Math.round(n * 100) / 100;
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function average(values) {
    if (values.length === 0)
        return null;
    return round2(values.reduce((a, b) => a + b, 0) / values.length);
}
exports.average = average;
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return round2((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return round2(sorted[mid]);
}
exports.median = median;
/** Erkennt Kühlzyklen: Start >= full, Ende <= empty. Keine 0-Füllung bei Lücken. */
function detectRuntimeCycles(points, cfg) {
    const cycles = [];
    let active = null;
    for (const p of points) {
        if (!active) {
            if (p.tempC >= cfg.fullThresholdC) {
                active = { startTs: p.ts, startTempC: p.tempC };
            }
            continue;
        }
        if (p.tempC <= cfg.emptyThresholdC) {
            const runtimeHours = (p.ts - active.startTs) / constants_1.MS_PER_HOUR;
            if (runtimeHours >= cfg.minRuntimeHours &&
                runtimeHours <= cfg.maxRuntimeHours &&
                active.startTempC > p.tempC) {
                const coolingRateCPerH = (active.startTempC - p.tempC) / runtimeHours;
                if (Number.isFinite(coolingRateCPerH) && coolingRateCPerH > 0) {
                    const startDate = new Date(active.startTs);
                    cycles.push({
                        startTs: active.startTs,
                        endTs: p.ts,
                        startTempC: round2(active.startTempC),
                        endTempC: round2(p.tempC),
                        runtimeHours: round3(runtimeHours),
                        coolingRateCPerH: round3(coolingRateCPerH),
                        season: (0, time_1.seasonFromDate)(startDate),
                        dayType: (0, time_1.dayTypeFromWeekday)((0, time_1.weekdayFromDate)(startDate)),
                    });
                }
            }
            active = null;
        }
    }
    return cycles;
}
exports.detectRuntimeCycles = detectRuntimeCycles;
function summarizeGroup(cycles) {
    const runtimes = cycles.map((c) => c.runtimeHours);
    const rates = cycles.map((c) => c.coolingRateCPerH);
    return {
        samples: cycles.length,
        runtime_hours_avg: average(runtimes),
        runtime_hours_median: median(runtimes),
        cooling_rate_c_per_h_avg: average(rates),
    };
}
function groupBySeason(cycles) {
    const out = {};
    for (const season of constants_1.SEASONS) {
        const group = cycles.filter((c) => c.season === season);
        if (group.length > 0) {
            out[season] = summarizeGroup(group);
        }
    }
    return out;
}
exports.groupBySeason = groupBySeason;
function groupByDayType(cycles) {
    const out = {};
    for (const dt of ["weekday", "weekend"]) {
        const group = cycles.filter((c) => c.dayType === dt);
        if (group.length > 0) {
            out[dt] = summarizeGroup(group);
        }
    }
    return out;
}
exports.groupByDayType = groupByDayType;
function estimateRemainingHours(params) {
    const { currentTempC, fullThresholdC, emptyThresholdC, typicalRuntimeHours, coolingRateCPerHAvg } = params;
    if (currentTempC === null || !Number.isFinite(currentTempC)) {
        return null;
    }
    if (currentTempC <= emptyThresholdC) {
        return 0;
    }
    if (currentTempC >= fullThresholdC) {
        return typicalRuntimeHours !== null ? round3(typicalRuntimeHours) : null;
    }
    if (coolingRateCPerHAvg !== null && coolingRateCPerHAvg > 0) {
        return round3((currentTempC - emptyThresholdC) / coolingRateCPerHAvg);
    }
    return null;
}
exports.estimateRemainingHours = estimateRemainingHours;
function estimatedEmptyAtIso(now, remainingHours) {
    if (remainingHours === null || !Number.isFinite(remainingHours)) {
        return null;
    }
    const ms = now.getTime() + remainingHours * constants_1.MS_PER_HOUR;
    return new Date(ms).toISOString();
}
exports.estimatedEmptyAtIso = estimatedEmptyAtIso;
function deriveHealth(samples, hasSource, configValid) {
    if (!configValid)
        return "invalid_config";
    if (!hasSource)
        return "no_source";
    if (samples === 0)
        return "no_samples";
    if (samples < constants_1.MIN_CYCLES_OK)
        return "degraded";
    return "ok";
}
function computeThermalRuntimeLearning(params) {
    const { cycles, currentTempC, cfg, sourceStateId, now } = params;
    const configValid = cfg.fullThresholdC > cfg.emptyThresholdC;
    if (!configValid) {
        return invalidConfigResult(sourceStateId);
    }
    const runtimes = cycles.map((c) => c.runtimeHours);
    const rates = cycles.map((c) => c.coolingRateCPerH);
    const runtimeHoursAvg = average(runtimes);
    const runtimeHoursMedian = median(runtimes);
    const coolingRateCPerHAvg = average(rates);
    const remaining = estimateRemainingHours({
        currentTempC,
        fullThresholdC: cfg.fullThresholdC,
        emptyThresholdC: cfg.emptyThresholdC,
        typicalRuntimeHours: runtimeHoursMedian ?? runtimeHoursAvg,
        coolingRateCPerHAvg,
    });
    const health = deriveHealth(cycles.length, Boolean(sourceStateId), configValid);
    let status = "ready";
    if (cycles.length === 0) {
        status = "insufficient_data";
    }
    else if (cycles.length < constants_1.MIN_CYCLES_OK) {
        status = "insufficient_data";
    }
    const historyJson = cycles.slice(-constants_1.MAX_HISTORY_JSON_CYCLES).map((c) => ({
        ...c,
        startTs: c.startTs,
        endTs: c.endTs,
    }));
    return {
        status,
        health,
        samples: cycles.length,
        runtimeHoursAvg,
        runtimeHoursMedian,
        coolingRateCPerHAvg,
        currentTemperatureC: currentTempC !== null ? round2(currentTempC) : null,
        estimatedRemainingHours: remaining,
        estimatedEmptyAt: estimatedEmptyAtIso(now, remaining),
        bySeasonJson: groupBySeason(cycles),
        byDayTypeJson: groupByDayType(cycles),
        historyJson,
        sourceStateId,
        lastError: "",
    };
}
exports.computeThermalRuntimeLearning = computeThermalRuntimeLearning;
function noSourceResult() {
    return {
        status: "no_source",
        health: "no_source",
        samples: 0,
        runtimeHoursAvg: null,
        runtimeHoursMedian: null,
        coolingRateCPerHAvg: null,
        currentTemperatureC: null,
        estimatedRemainingHours: null,
        estimatedEmptyAt: null,
        bySeasonJson: {},
        byDayTypeJson: {},
        historyJson: [],
        sourceStateId: "",
        lastError: "Keine Temperatur-Quelle — Admin-State oder addons.immersion_heater.mapping.buffer_temp_c konfigurieren.",
    };
}
exports.noSourceResult = noSourceResult;
function disabledResult() {
    return {
        ...noSourceResult(),
        status: "disabled",
        lastError: "Thermal Runtime Learning in Admin deaktiviert.",
    };
}
exports.disabledResult = disabledResult;
function invalidConfigResult(sourceStateId) {
    return {
        status: "invalid_config",
        health: "invalid_config",
        samples: 0,
        runtimeHoursAvg: null,
        runtimeHoursMedian: null,
        coolingRateCPerHAvg: null,
        currentTemperatureC: null,
        estimatedRemainingHours: null,
        estimatedEmptyAt: null,
        bySeasonJson: {},
        byDayTypeJson: {},
        historyJson: [],
        sourceStateId,
        lastError: "Ungültige Schwellwerte: full_threshold_c muss größer als empty_threshold_c sein.",
    };
}
exports.invalidConfigResult = invalidConfigResult;
function errorResult(message, sourceStateId) {
    return {
        ...noSourceResult(),
        status: "error",
        health: "error",
        sourceStateId,
        lastError: message,
    };
}
exports.errorResult = errorResult;
