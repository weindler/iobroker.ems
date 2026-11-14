"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPvContribution = buildPvContribution;
const quality_1 = require("../quality");
const contribution_ids_1 = require("../contribution_ids");
const time_1 = require("../time");
const types_1 = require("./types");
const pv_shape_1 = require("./pv_shape");
const site_factor_1 = require("../../learning/pv_profile/site_factor");
const pv_intraday_1 = require("./pv_intraday");
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
function pvShapeSlotContributions(dateKey, dailyKwh, shape, intraday) {
    const daySlots = fullDaySlots(dateKey, shape.timezone);
    let shaped = (0, pv_shape_1.buildPvShapeForDay)(daySlots, dailyKwh, shape.latDeg, shape.lonDeg, shape.hourlyPoints, shape.capW, shape.siteProfile?.active ? (ms) => (0, site_factor_1.siteFactorAt)(shape.siteProfile ?? null, ms, shape.timezone) : undefined);
    if (intraday) {
        const items = shaped.map((s) => ({ startIso: s.slot.startIso, endIso: s.slot.endIso, pvPowerW: s.pvPowerW }));
        const result = (0, pv_intraday_1.computeIntradayFactor)(items, intraday.actualTodayKwh, intraday.nowMs, intraday.actualRecent);
        intraday.onResult(result);
        if (result.active) {
            const scaled = (0, pv_intraday_1.applyIntradayFactor)(items, result.factor, intraday.nowMs);
            shaped = shaped.map((s, i) => ({ ...s, pvPowerW: scaled[i].pvPowerW }));
        }
    }
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
    let intradayResult = null;
    if (hasForecast && input.shape && input.shape.latDeg !== null && input.shape.lonDeg !== null) {
        // Arbeitsplan Punkt 5: 15-Min-Form für alle Horizon-Tage mit kWh (Daily Plan 72 h),
        // nicht nur heute/morgen — nie erfundene Tages-kWh.
        const today = todayKey ?? (0, time_1.localDateKeyInTimezone)(input.now, input.shape.timezone);
        const dayKwhByKey = new Map();
        dayKwhByKey.set(today, input.correctedTodayKwh);
        dayKwhByKey.set(tomorrowKey ?? (0, time_1.addDaysToDateKey)(today, 1), input.correctedTomorrowKwh);
        for (const day of input.horizonDays) {
            if (!day.dateKey)
                continue;
            if (!dayKwhByKey.has(day.dateKey) || day.dayIndex >= 2) {
                dayKwhByKey.set(day.dateKey, day.correctedKwh);
            }
        }
        const orderedKeys = [...dayKwhByKey.keys()].sort();
        for (const dateKey of orderedKeys) {
            const kwh = dayKwhByKey.get(dateKey) ?? null;
            if (kwh === null || !Number.isFinite(kwh))
                continue;
            slots.push(...pvShapeSlotContributions(dateKey, kwh, input.shape, dateKey === today
                ? {
                    actualTodayKwh: input.actualTodayKwh ?? null,
                    actualRecent: input.actualRecent ?? null,
                    nowMs: input.now.getTime(),
                    onResult: (r) => {
                        intradayResult = r;
                    },
                }
                : undefined));
        }
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
            expectedTodayKwh: (() => {
                const r = intradayResult;
                if (!r || input.correctedTodayKwh === null || !Number.isFinite(input.correctedTodayKwh))
                    return null;
                if (!r.active || r.actualSoFarKwh === null)
                    return input.correctedTodayKwh;
                const rest = Math.max(0, input.correctedTodayKwh - r.expectedSoFarKwh) * r.factor;
                return Math.round((r.actualSoFarKwh + rest) * 100) / 100;
            })(),
            intradayFactor: intradayResult ? intradayResult.factor : null,
            intradayActive: intradayResult ? intradayResult.active : false,
            intradayExpectedSoFarKwh: intradayResult ? intradayResult.expectedSoFarKwh : null,
            intradayActualSoFarKwh: intradayResult ? intradayResult.actualSoFarKwh : null,
            intradayReasonDe: intradayResult ? intradayResult.reasonDe : null,
            slotResolution: shapeActive ? "weather_shaped_15min" : "daily_only",
            slotNoteDe: shapeActive
                ? "15-Minuten-PV-Form aus Sonnenstand + Bewölkung/Solar-Schätzung, normiert auf gelernte Tages-kWh."
                : "Keine belastbare 15-Minuten-PV-Leistung — nur Tages-kWh (Lat/Lon oder Wetterdaten fehlen).",
        },
        slots,
    });
}
