"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPvContribution = void 0;
const quality_1 = require("../quality");
const contribution_ids_1 = require("../contribution_ids");
const time_1 = require("../time");
const types_1 = require("./types");
const pv_shape_1 = require("./pv_shape");
function fullDaySlots(dateKey, timezone) {
    const dayStartIso = (0, time_1.isoAtTimezoneLocal)(dateKey, 0, 0, timezone);
    const dayEndIso = (0, time_1.isoAtTimezoneLocal)((0, time_1.addDaysToDateKey)(dateKey, 1), 0, 0, timezone);
    const startMs = Date.parse(dayStartIso);
    const endMs = Date.parse(dayEndIso);
    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs)
        return [];
    const slots = [];
    let cursor = startMs;
    while (cursor < endMs) {
        const next = cursor + 15 * 60_000;
        slots.push({ startIso: new Date(cursor).toISOString(), endIso: new Date(next).toISOString() });
        cursor = next;
    }
    return slots;
}
function pvShapeSlotContributions(dateKey, dailyKwh, shape) {
    const daySlots = fullDaySlots(dateKey, shape.timezone);
    const shaped = (0, pv_shape_1.buildPvShapeForDay)(daySlots, dailyKwh, shape.latDeg, shape.lonDeg, shape.hourlyPoints, shape.capW);
    return shaped.map((s) => ({
        slot: s.slot,
        minPowerW: s.pvPowerW,
        preferredPowerW: s.pvPowerW,
        maxPowerW: s.pvPowerW,
        requiredEnergyKwh: null,
        availableEnergyKwh: null,
        priceCtPerKwh: null,
        available: true,
        mandatory: false,
        quality: (0, quality_1.operatorQuality)("valid", "Wetterbasierte PV-Form (Sonnenstand + Bewölkung/Solar-Schätzung)."),
    }));
}
function isStale(lastUpdateTs, now, maxAgeHours) {
    if (!lastUpdateTs)
        return true;
    const ms = Date.parse(lastUpdateTs);
    if (!Number.isFinite(ms))
        return true;
    return now.getTime() - ms > maxAgeHours * 3_600_000;
}
function buildPvContribution(input) {
    const generatedAt = input.now.toISOString();
    const confidence = (0, types_1.clampConfidencePct)(input.confidencePct);
    const hasForecast = (0, types_1.isPvForecastPresent)(input.correctedTodayKwh, input.correctedTomorrowKwh, input.status);
    const stale = isStale(input.lastUpdateTs, input.now, 36);
    let status = "missing";
    let reasonDe = "Keine gültige PV-Prognose vorhanden.";
    if (hasForecast) {
        if (input.status === "ready" && !stale) {
            status = "valid";
            reasonDe = "Korrigierte PV-Tagesprognose aus Learning PV-Bias.";
        }
        else if (stale) {
            status = "degraded";
            reasonDe = "PV-Prognose vorhanden, aber veraltet.";
        }
        else if (input.status === "insufficient_data") {
            status = "degraded";
            reasonDe = "PV-Prognose mit eingeschränkter Datenbasis.";
        }
        else {
            status = "degraded";
            reasonDe = `PV-Prognose mit Status ${input.status ?? "unbekannt"}.`;
        }
    }
    const todayKey = input.horizonDays.find((d) => d.dayIndex === 0)?.dateKey ?? null;
    const tomorrowKey = input.horizonDays.find((d) => d.dayIndex === 1)?.dateKey ?? null;
    const slots = [];
    let shapeActive = false;
    if (hasForecast && input.shape && input.shape.latDeg !== null && input.shape.lonDeg !== null) {
        const today = todayKey ?? (0, time_1.localDateKeyInTimezone)(input.now, input.shape.timezone);
        const tomorrow = tomorrowKey ?? (0, time_1.addDaysToDateKey)(today, 1);
        const todaySlots = pvShapeSlotContributions(today, input.correctedTodayKwh, input.shape);
        const tomorrowSlots = pvShapeSlotContributions(tomorrow, input.correctedTomorrowKwh, input.shape);
        slots.push(...todaySlots, ...tomorrowSlots);
        shapeActive = slots.length > 0;
    }
    return (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY, (0, types_1.pvContributorRef)(), "provide", ["supply"], {
        generatedAt,
        validUntil: null,
        revision: 1,
        enabled: hasForecast,
        flexible: false,
        gridEligible: false,
        quality: (0, quality_1.operatorQuality)(status, reasonDe, confidence),
        reasonDe,
        details: {
            source: input.source,
            lastUpdateTs: input.lastUpdateTs,
            status: input.status,
            correctedTodayKwh: input.correctedTodayKwh,
            correctedTomorrowKwh: input.correctedTomorrowKwh,
            rawTodayKwh: input.rawTodayKwh,
            rawTomorrowKwh: input.rawTomorrowKwh,
            todayDateKey: todayKey,
            tomorrowDateKey: tomorrowKey,
            horizonDays: input.horizonDays,
            slotResolution: shapeActive ? "weather_shaped_15min" : "daily_only",
            slotNoteDe: shapeActive
                ? "15-Minuten-PV-Form aus Sonnenstand + Bewölkung/Solar-Schätzung, normiert auf gelernte Tages-kWh."
                : "Keine belastbare 15-Minuten-PV-Leistung — nur Tages-kWh (Lat/Lon oder Wetterdaten fehlen).",
        },
        slots,
    });
}
exports.buildPvContribution = buildPvContribution;
