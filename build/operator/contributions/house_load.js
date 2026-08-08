"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildHouseLoadContribution = exports.dailyKwhFromHouseLoadDayForecast = void 0;
const constants_1 = require("../../learning/house_load/constants");
const battery_winter_1 = require("../planning/battery_winter");
const quality_1 = require("../quality");
const contributor_1 = require("../contributor");
const time_1 = require("../time");
const contribution_ids_1 = require("../contribution_ids");
const types_1 = require("./types");
function dailyKwhFromHouseLoadDayForecast(json) {
    return (0, battery_winter_1.dailyKwhFromHouseLoadForecast)(json);
}
exports.dailyKwhFromHouseLoadDayForecast = dailyKwhFromHouseLoadDayForecast;
function segmentSlotsFromForecast(forecast, timezone, confidence) {
    const slots = [];
    for (const segment of constants_1.SEGMENTS) {
        const entry = forecast.segments[segment];
        if (entry?.avg_w == null || !Number.isFinite(entry.avg_w))
            continue;
        const bounds = constants_1.SEGMENT_HOURS[segment];
        const startIso = (0, time_1.isoAtTimezoneLocal)(forecast.date, bounds.start, 0, timezone);
        const endIso = (0, time_1.isoAtTimezoneLocal)(forecast.date, bounds.end === 24 ? 23 : bounds.end, bounds.end === 24 ? 59 : 0, timezone);
        if (bounds.end === 24) {
            const nextDay = (0, time_1.addDaysToDateKey)(forecast.date, 1);
            const endMs = (0, time_1.isoAtTimezoneLocal)(nextDay, 0, 0, timezone);
            slots.push(makeSegmentSlot(startIso, endMs, entry.avg_w, entry, confidence));
        }
        else {
            slots.push(makeSegmentSlot(startIso, endIso, entry.avg_w, entry, confidence));
        }
    }
    return slots.sort((a, b) => a.slot.startIso.localeCompare(b.slot.startIso));
}
function makeSegmentSlot(startIso, endIso, avgW, entry, confidence) {
    const hours = (Date.parse(endIso) - Date.parse(startIso)) / 3_600_000;
    const energyKwh = hours > 0 ? Math.round((avgW * hours) / 1000 * 1000) / 1000 : null;
    return {
        slot: { startIso, endIso },
        minPowerW: avgW,
        preferredPowerW: avgW,
        maxPowerW: avgW,
        requiredEnergyKwh: energyKwh,
        availableEnergyKwh: null,
        priceCtPerKwh: null,
        available: true,
        mandatory: true,
        quality: (0, quality_1.operatorQuality)("valid", "Segment-Baseline aus House-Load-Learning.", entry.confidence ?? confidence),
    };
}
function worstFallbackLevel(forecast) {
    if (!forecast)
        return null;
    let worst = null;
    const rank = {
        none: 0,
        season_weekday_segment: 1,
        season_day_type_segment: 2,
        all_seasons_weekday_segment: 3,
        global_segment: 4,
        median_all: 5,
    };
    for (const segment of constants_1.SEGMENTS) {
        const entry = forecast.segments[segment];
        if (!entry)
            continue;
        const level = entry.fallback_level ?? "none";
        if (worst === null || (rank[level] ?? 99) > (rank[worst] ?? -1)) {
            worst = level;
        }
    }
    return worst;
}
function buildHouseLoadContribution(input) {
    const generatedAt = input.now.toISOString();
    const confidence = (0, types_1.clampConfidencePct)(input.confidence);
    const todayKwh = dailyKwhFromHouseLoadDayForecast(input.forecastToday);
    const tomorrowKwh = dailyKwhFromHouseLoadDayForecast(input.forecastTomorrow);
    const hasForecast = todayKwh !== null || tomorrowKwh !== null;
    let status = "missing";
    let reasonDe = "Keine gültige Hauslast-Prognose vorhanden.";
    if (hasForecast) {
        const ready = input.status === "ready" || input.status === "degraded";
        const fallbackToday = worstFallbackLevel(input.forecastToday);
        const fallbackTomorrow = worstFallbackLevel(input.forecastTomorrow);
        const heavyFallback = (fallbackToday && fallbackToday !== "none" && fallbackToday !== "season_weekday_segment") ||
            (fallbackTomorrow && fallbackTomorrow !== "none" && fallbackTomorrow !== "season_weekday_segment");
        if (ready && !heavyFallback) {
            status = input.status === "degraded" ? "degraded" : "valid";
            reasonDe =
                input.status === "degraded"
                    ? "Hauslast-Prognose mit eingeschränkter Datenqualität."
                    : "Erwartete feste Hauslast aus House-Load-Learning.";
        }
        else {
            status = "degraded";
            reasonDe = heavyFallback
                ? `Hauslast-Prognose mit Fallback-Ebene ${fallbackToday ?? fallbackTomorrow}.`
                : "Hauslast-Prognose mit eingeschränktem Status.";
        }
    }
    const slots = [];
    if (input.forecastToday) {
        slots.push(...segmentSlotsFromForecast(input.forecastToday, input.timezone, confidence));
    }
    if (input.forecastTomorrow) {
        slots.push(...segmentSlotsFromForecast(input.forecastTomorrow, input.timezone, confidence));
    }
    // Roadmap Block 5: Segment-Slots auch für Tag 3+ (Daily-Plan-Horizont ≥48 h) —
    // gleiche Musterprognose wie morgen, keine erfundenen Werte.
    for (const forecast of input.forecastHorizon ?? []) {
        if (!forecast?.date)
            continue;
        slots.push(...segmentSlotsFromForecast(forecast, input.timezone, confidence));
    }
    const todayKey = input.forecastToday?.date ?? (0, time_1.localDateKeyInTimezone)(input.now, input.timezone);
    const tomorrowKey = input.forecastTomorrow?.date ?? (0, time_1.addDaysToDateKey)((0, time_1.localDateKeyInTimezone)(input.now, input.timezone), 1);
    const horizonDays = (input.forecastHorizon ?? []).map((forecast, idx) => ({
        dayIndex: idx + 2,
        dateKey: forecast.date,
        kwh: dailyKwhFromHouseLoadDayForecast(forecast),
        confidencePct: confidence,
    }));
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, (0, contributor_1.systemContributorRef)("house_load"), "consume", ["demand_fixed"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: hasForecast,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, reasonDe, confidence),
        reasonDe,
        details: {
            lastUpdate: input.lastUpdate,
            status: input.status,
            expectedFixedTodayKwh: todayKwh,
            expectedFixedTomorrowKwh: tomorrowKwh,
            todayDateKey: todayKey,
            tomorrowDateKey: tomorrowKey,
            horizonDays,
            fallbackLevelToday: worstFallbackLevel(input.forecastToday),
            fallbackLevelTomorrow: worstFallbackLevel(input.forecastTomorrow),
            slotResolution: slots.length > 0 ? "segment_baseline" : "daily_only",
            slotNoteDe: slots.length > 0
                ? "Segment-Baselines (nicht-steuerbare Grundlast, EMS-Flex separat) — keine künstliche 15-Minuten-Auflösung innerhalb der Segmente."
                : "Keine belastbaren Segment-Zeitfenster — nur Tagesaggregate.",
        },
        slots,
    });
}
exports.buildHouseLoadContribution = buildHouseLoadContribution;
