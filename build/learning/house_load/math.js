"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.disabledResult = exports.noSourceResult = exports.computeHouseLoadLearning = exports.countForecastFallbacks = exports.buildDayForecast = exports.lookupSegmentProfile = exports.accumulatorsToProfileJson = exports.buildProfileAccumulators = exports.confidencePctFromSamples = exports.cellConfidence = void 0;
const constants_1 = require("./constants");
const history_1 = require("./history");
const time_1 = require("./time");
function roundW(n) {
    return Math.round(n);
}
function cellConfidence(samples) {
    if (samples <= 0)
        return 0;
    return Math.round(Math.min(1, samples / constants_1.CONFIDENCE_TARGET_SAMPLES) * 1000) / 1000;
}
exports.cellConfidence = cellConfidence;
function confidencePctFromSamples(samples, sampleDays) {
    const hourScore = Math.min(40, (samples / (constants_1.CONFIDENCE_TARGET_SAMPLES * 24)) * 40);
    const dayScore = Math.min(60, (sampleDays / 30) * 60);
    return Math.round(Math.min(100, hourScore + dayScore));
}
exports.confidencePctFromSamples = confidencePctFromSamples;
function emptyProfile() {
    const root = {};
    for (const season of constants_1.SEASONS) {
        root[season] = {};
    }
    return root;
}
function buildProfileAccumulators(samples) {
    const acc = emptyProfile();
    for (const s of samples) {
        const seasonMap = acc[s.season] ?? {};
        acc[s.season] = seasonMap;
        const dayMap = seasonMap[s.weekday] ?? {};
        seasonMap[s.weekday] = dayMap;
        const cell = dayMap[s.segment] ?? { sumW: 0, count: 0, values: [] };
        cell.values.push(s.powerW);
        cell.sumW += s.powerW;
        cell.count += 1;
        dayMap[s.segment] = cell;
    }
    return acc;
}
exports.buildProfileAccumulators = buildProfileAccumulators;
function finalizeCell(acc) {
    if (!acc || acc.count < constants_1.MIN_PROFILE_SAMPLES) {
        return null;
    }
    const filtered = (0, history_1.filterOutliers)(acc.values);
    if (filtered.length < constants_1.MIN_PROFILE_SAMPLES) {
        return null;
    }
    const avgW = roundW(filtered.reduce((a, b) => a + b, 0) / filtered.length);
    return {
        avgW,
        samples: filtered.length,
        confidence: cellConfidence(filtered.length),
    };
}
function accumulatorsToProfileJson(acc) {
    const profile = {};
    for (const season of constants_1.SEASONS) {
        const seasonOut = {};
        let seasonHasData = false;
        for (const weekday of constants_1.WEEKDAYS) {
            const dayOut = {};
            let dayHasData = false;
            for (const segment of constants_1.SEGMENTS) {
                const cell = finalizeCell(acc[season]?.[weekday]?.[segment]);
                if (cell) {
                    dayOut[segment] = cell;
                    dayHasData = true;
                }
            }
            if (dayHasData) {
                seasonOut[weekday] = dayOut;
                seasonHasData = true;
            }
        }
        if (seasonHasData) {
            profile[season] = seasonOut;
        }
    }
    return profile;
}
exports.accumulatorsToProfileJson = accumulatorsToProfileJson;
function avgFromAccumulators(cells) {
    const values = [];
    for (const c of cells) {
        values.push(...(0, history_1.filterOutliers)(c.values));
    }
    if (values.length < constants_1.MIN_PROFILE_SAMPLES) {
        return null;
    }
    return roundW(values.reduce((a, b) => a + b, 0) / values.length);
}
function collectCells(acc, predicate, segment) {
    const out = [];
    for (const season of constants_1.SEASONS) {
        for (const weekday of constants_1.WEEKDAYS) {
            if (!predicate(season, weekday))
                continue;
            const cell = acc[season]?.[weekday]?.[segment];
            if (cell && cell.count > 0) {
                out.push(cell);
            }
        }
    }
    return out;
}
function median(values) {
    if (values.length === 0)
        return null;
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    if (sorted.length % 2 === 0) {
        return roundW((sorted[mid - 1] + sorted[mid]) / 2);
    }
    return roundW(sorted[mid]);
}
function lookupSegmentProfile(acc, season, weekday, dayType, segment) {
    const direct = finalizeCell(acc[season]?.[weekday]?.[segment]);
    if (direct) {
        return {
            avgW: direct.avgW,
            confidence: direct.confidence,
            source: `${season}/${weekday}/${segment}`,
            fallbackLevel: "season_weekday_segment",
        };
    }
    const dayTypeCells = collectCells(acc, (s, w) => s === season && (0, time_1.dayTypeFromWeekday)(w) === dayType, segment);
    const dayTypeAvg = avgFromAccumulators(dayTypeCells);
    if (dayTypeAvg !== null) {
        return {
            avgW: dayTypeAvg,
            confidence: cellConfidence(dayTypeCells.reduce((n, c) => n + c.count, 0)),
            source: `${season}/${dayType}/${segment}`,
            fallbackLevel: "season_day_type_segment",
        };
    }
    const allSeasonCells = collectCells(acc, (_s, w) => w === weekday, segment);
    const allSeasonAvg = avgFromAccumulators(allSeasonCells);
    if (allSeasonAvg !== null) {
        return {
            avgW: allSeasonAvg,
            confidence: cellConfidence(allSeasonCells.reduce((n, c) => n + c.count, 0)),
            source: `all_seasons/${weekday}/${segment}`,
            fallbackLevel: "all_seasons_weekday_segment",
        };
    }
    const globalCells = collectCells(acc, () => true, segment);
    const globalAvg = avgFromAccumulators(globalCells);
    if (globalAvg !== null) {
        return {
            avgW: globalAvg,
            confidence: cellConfidence(globalCells.reduce((n, c) => n + c.count, 0)),
            source: `global/${segment}`,
            fallbackLevel: "global_segment",
        };
    }
    const allValues = [];
    for (const s of globalCells) {
        allValues.push(...s.values);
    }
    const med = median((0, history_1.filterOutliers)(allValues));
    if (med !== null) {
        return {
            avgW: med,
            confidence: cellConfidence(allValues.length),
            source: `median/${segment}`,
            fallbackLevel: "median_all",
        };
    }
    return { avgW: null, confidence: 0, source: "none", fallbackLevel: "none" };
}
exports.lookupSegmentProfile = lookupSegmentProfile;
function buildDayForecast(acc, dayOffset) {
    const ctx = (0, time_1.contextForDayOffset)(dayOffset);
    const segments = {};
    for (const segment of constants_1.SEGMENTS) {
        const lookup = lookupSegmentProfile(acc, ctx.season, ctx.weekday, ctx.dayType, segment);
        segments[segment] = {
            avg_w: lookup.avgW,
            source: lookup.source,
            fallback_level: lookup.fallbackLevel,
            confidence: lookup.confidence,
        };
    }
    return {
        date: ctx.dateKey,
        season: ctx.season,
        weekday: ctx.weekday,
        day_type: ctx.dayType,
        segments,
    };
}
exports.buildDayForecast = buildDayForecast;
function countForecastFallbacks(forecast) {
    let n = 0;
    for (const segment of constants_1.SEGMENTS) {
        const entry = forecast.segments[segment];
        if (!entry)
            continue;
        if (entry.fallback_level !== "none" &&
            entry.fallback_level !== "season_weekday_segment") {
            n += 1;
        }
    }
    return n;
}
exports.countForecastFallbacks = countForecastFallbacks;
function computeHouseLoadLearning(params) {
    const nowCtx = (0, time_1.calendarContext)(params.now);
    const acc = buildProfileAccumulators(params.samples);
    const profileJson = accumulatorsToProfileJson(acc);
    const forecastTodayJson = buildDayForecast(acc, 0);
    const forecastTomorrowJson = buildDayForecast(acc, 1);
    const fallbacksUsed = countForecastFallbacks(forecastTodayJson) + countForecastFallbacks(forecastTomorrowJson);
    const confidence = confidencePctFromSamples(params.samples.length, params.sampleDays);
    let healthStatus = "ok";
    if (params.sampleDays < 7 || params.samples.length < constants_1.MIN_DAY_HOURS * 3) {
        healthStatus = "degraded";
    }
    let status = "ready";
    if (params.samples.length === 0) {
        status = "insufficient_data";
        healthStatus = "degraded";
    }
    else if (params.sampleDays < 3) {
        status = "insufficient_data";
    }
    const healthJson = {
        status: healthStatus,
        sample_count: params.samples.length,
        sample_days: params.sampleDays,
        active_season: nowCtx.season,
        active_weekday: nowCtx.weekday,
        active_day_type: nowCtx.dayType,
        fallbacks_used: fallbacksUsed,
        missing_source: false,
        source_state_id: params.sourceStateId,
        last_valid_measurement_ts: params.lastValidTs
            ? new Date(params.lastValidTs).toISOString()
            : null,
        last_persist_at: params.lastPersistAt,
    };
    return {
        status,
        healthStatus,
        sampleCount: params.samples.length,
        sampleDays: params.sampleDays,
        confidence,
        currentSegment: nowCtx.segment,
        currentSeason: nowCtx.season,
        currentWeekday: nowCtx.weekday,
        currentDayType: nowCtx.dayType,
        profileJson,
        forecastTodayJson,
        forecastTomorrowJson,
        healthJson,
        sourceStateId: params.sourceStateId,
        error: "",
    };
}
exports.computeHouseLoadLearning = computeHouseLoadLearning;
function noSourceResult(sourceStateId, now) {
    const nowCtx = (0, time_1.calendarContext)(now);
    const emptyForecast = buildDayForecast(emptyProfile(), 0);
    return {
        status: "no_source",
        healthStatus: "no_source",
        sampleCount: 0,
        sampleDays: 0,
        confidence: 0,
        currentSegment: nowCtx.segment,
        currentSeason: nowCtx.season,
        currentWeekday: nowCtx.weekday,
        currentDayType: nowCtx.dayType,
        profileJson: {},
        forecastTodayJson: emptyForecast,
        forecastTomorrowJson: buildDayForecast(emptyProfile(), 1),
        healthJson: {
            status: "no_source",
            sample_count: 0,
            sample_days: 0,
            active_season: nowCtx.season,
            active_weekday: nowCtx.weekday,
            active_day_type: nowCtx.dayType,
            fallbacks_used: 0,
            missing_source: true,
            source_state_id: sourceStateId,
            last_valid_measurement_ts: null,
            last_persist_at: null,
        },
        sourceStateId: "",
        error: "Keine Hauslast-Quelle — Admin-State oder addons.battery.mapping.consumption_w konfigurieren.",
    };
}
exports.noSourceResult = noSourceResult;
function disabledResult() {
    const now = new Date();
    const r = noSourceResult("", now);
    return {
        ...r,
        status: "disabled",
        error: "House Load Learning in Admin deaktiviert.",
    };
}
exports.disabledResult = disabledResult;
function errorResult(message, sourceStateId, now) {
    const r = noSourceResult(sourceStateId, now);
    return {
        ...r,
        status: "error",
        healthStatus: "degraded",
        sourceStateId,
        error: message,
        healthJson: { ...r.healthJson, status: "degraded", source_state_id: sourceStateId },
    };
}
exports.errorResult = errorResult;
