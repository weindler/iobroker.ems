"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.disabledResult = exports.noSourceResult = exports.computeBatteryRuntimeLearning = exports.estimateRuntimeDays = exports.computeTopoffStatus = exports.calendarDaysSince = exports.findLastFullCharge = exports.resolveLastFullCharge = exports.fullChargeFromSecondsSince = exports.computePowerStats = exports.computeSocRates = exports.computeNightDischarges = void 0;
const constants_1 = require("./constants");
const time_1 = require("./time");
function round2(n) {
    return Math.round(n * 100) / 100;
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function average(values) {
    if (values.length === 0)
        return null;
    return round3(values.reduce((a, b) => a + b, 0) / values.length);
}
function findNearestSoc(points, targetTs, maxDeltaMs) {
    let best = null;
    let bestDelta = Infinity;
    for (const p of points) {
        const delta = Math.abs(p.ts - targetTs);
        if (delta <= maxDeltaMs && delta < bestDelta) {
            best = p;
            bestDelta = delta;
        }
    }
    return best?.socPct ?? null;
}
/** Nachtentladung: SOC-Abfall zwischen nightStart (Tag D) und nightEnd (Tag D+1). */
function computeNightDischarges(params) {
    const fixedStart = (0, time_1.parseTimeHHMM)(params.nightStart);
    const fixedEnd = (0, time_1.parseTimeHHMM)(params.nightEnd);
    if (!fixedStart || !fixedEnd || params.socPoints.length === 0) {
        return { avgPct: null, avgKwh: null, validNights: 0 };
    }
    const dateKeys = [...new Set(params.socPoints.map((p) => (0, time_1.localDateKey)(new Date(p.ts))))].sort();
    const pctDischarges = [];
    const kwhDischarges = [];
    const maxDelta = 2 * constants_1.MS_PER_HOUR;
    for (let i = 0; i < dateKeys.length - 1; i++) {
        const dayKey = dateKeys[i];
        const nextKey = dateKeys[i + 1];
        const startTime = params.astroDaily?.startByDate.get(dayKey) ?? fixedStart;
        const endTime = params.astroDaily?.endByDate.get(nextKey) ?? fixedEnd;
        const startTs = (0, time_1.timestampAtLocalTime)(dayKey, startTime.hour, startTime.minute);
        const endTs = (0, time_1.timestampAtLocalTime)(nextKey, endTime.hour, endTime.minute);
        if (endTs <= startTs)
            continue;
        const socStart = findNearestSoc(params.socPoints, startTs, maxDelta);
        const socEnd = findNearestSoc(params.socPoints, endTs, maxDelta);
        if (socStart === null || socEnd === null)
            continue;
        const dischargePct = socStart - socEnd;
        if (dischargePct <= 0 || dischargePct > 50)
            continue;
        pctDischarges.push(round2(dischargePct));
        if (params.capacityKwh !== null) {
            kwhDischarges.push(round3((dischargePct / 100) * params.capacityKwh));
        }
    }
    return {
        avgPct: average(pctDischarges),
        avgKwh: params.capacityKwh !== null ? average(kwhDischarges) : null,
        validNights: pctDischarges.length,
    };
}
exports.computeNightDischarges = computeNightDischarges;
function computeSocRates(socPoints) {
    const chargeRates = [];
    const dischargeRates = [];
    for (let i = 1; i < socPoints.length; i++) {
        const prev = socPoints[i - 1];
        const cur = socPoints[i];
        const dtHours = (cur.ts - prev.ts) / constants_1.MS_PER_HOUR;
        if (dtHours <= 0 || dtHours > 6)
            continue;
        const dSoc = cur.socPct - prev.socPct;
        if (dSoc > 0.05) {
            chargeRates.push(dSoc / dtHours);
        }
        else if (dSoc < -0.05) {
            dischargeRates.push(Math.abs(dSoc) / dtHours);
        }
    }
    return {
        avgChargeRatePctH: average(chargeRates),
        avgDischargeRatePctH: average(dischargeRates),
    };
}
exports.computeSocRates = computeSocRates;
function computePowerStats(powerPoints) {
    const charge = [];
    const discharge = [];
    for (const p of powerPoints) {
        if (p.powerW > 0)
            charge.push(p.powerW);
        else if (p.powerW < 0)
            discharge.push(Math.abs(p.powerW));
    }
    return {
        avgChargePowerW: average(charge),
        avgDischargePowerW: average(discharge),
        maxChargePowerW: charge.length ? Math.max(...charge) : null,
        maxDischargePowerW: discharge.length ? Math.max(...discharge) : null,
    };
}
exports.computePowerStats = computePowerStats;
/** Zeitpunkt der letzten Vollladung aus Geräte-Counter (Sekunden seit Voll). */
function fullChargeFromSecondsSince(seconds, now) {
    return new Date(now.getTime() - seconds * 1000).toISOString();
}
exports.fullChargeFromSecondsSince = fullChargeFromSecondsSince;
function resolveLastFullCharge(params) {
    if (params.secondsSinceFull !== null) {
        return {
            lastFullCharge: fullChargeFromSecondsSince(params.secondsSinceFull, params.now),
            fullChargeSource: "device",
        };
    }
    const live = params.currentSocPct !== null
        ? { socPct: params.currentSocPct, ts: params.now.getTime() }
        : null;
    return {
        lastFullCharge: findLastFullCharge(params.socPointsForFullCharge, params.fullChargeSoc, live),
        fullChargeSource: params.socPointsForFullCharge.length > 0 || live ? "soc_history" : null,
    };
}
exports.resolveLastFullCharge = resolveLastFullCharge;
function findLastFullCharge(socPoints, fullChargeSoc, live) {
    let lastTs = null;
    for (const p of socPoints) {
        if (p.socPct >= fullChargeSoc) {
            lastTs = p.ts;
        }
    }
    if (live && live.socPct >= fullChargeSoc && (lastTs === null || live.ts >= lastTs)) {
        lastTs = live.ts;
    }
    return lastTs !== null ? new Date(lastTs).toISOString() : null;
}
exports.findLastFullCharge = findLastFullCharge;
/** Kalendertage (lokal) zwischen Vollladung und jetzt — „gestern voll“ = 1. */
function calendarDaysSince(isoTs, now) {
    const lastMs = Date.parse(isoTs);
    if (!Number.isFinite(lastMs)) {
        return null;
    }
    const lastDay = new Date(lastMs);
    lastDay.setHours(0, 0, 0, 0);
    const nowDay = new Date(now);
    nowDay.setHours(0, 0, 0, 0);
    return Math.round((nowDay.getTime() - lastDay.getTime()) / constants_1.MS_PER_DAY);
}
exports.calendarDaysSince = calendarDaysSince;
function computeTopoffStatus(params) {
    if (!params.lastFullCharge) {
        return { daysSinceFull: null, topoffDaysRemaining: null, topoffDue: null };
    }
    const daysSinceFull = calendarDaysSince(params.lastFullCharge, params.now);
    if (daysSinceFull === null) {
        return { daysSinceFull: null, topoffDaysRemaining: null, topoffDue: null };
    }
    const topoffDaysRemaining = Math.max(0, params.topoffIntervalDays - daysSinceFull);
    return {
        daysSinceFull,
        topoffDaysRemaining,
        topoffDue: daysSinceFull >= params.topoffIntervalDays,
    };
}
exports.computeTopoffStatus = computeTopoffStatus;
function estimateRuntimeDays(currentSocPct, avgNightDischargePct) {
    if (currentSocPct === null ||
        avgNightDischargePct === null ||
        avgNightDischargePct <= 0 ||
        currentSocPct <= 0) {
        return null;
    }
    return round2(currentSocPct / avgNightDischargePct);
}
exports.estimateRuntimeDays = estimateRuntimeDays;
function computeBatteryRuntimeLearning(params) {
    const night = computeNightDischarges({
        socPoints: params.socPoints,
        nightStart: params.cfg.nightStart,
        nightEnd: params.cfg.nightEnd,
        astroDaily: params.astroDaily,
        capacityKwh: params.capacityKwh,
    });
    const rates = computeSocRates(params.socPoints);
    const powerStats = params.powerPoints.length > 0
        ? computePowerStats(params.powerPoints)
        : {
            avgChargePowerW: null,
            avgDischargePowerW: null,
            maxChargePowerW: null,
            maxDischargePowerW: null,
        };
    const fullChargePoints = params.socPointsForFullCharge ?? params.socPoints;
    const { lastFullCharge, fullChargeSource } = resolveLastFullCharge({
        secondsSinceFull: params.secondsSinceFull,
        socPointsForFullCharge: fullChargePoints,
        fullChargeSoc: params.cfg.fullChargeSoc,
        currentSocPct: params.currentSocPct,
        now: params.now,
    });
    const topoff = computeTopoffStatus({
        lastFullCharge,
        topoffIntervalDays: params.cfg.topoffIntervalDays,
        now: params.now,
    });
    const estimatedRuntimeDays = estimateRuntimeDays(params.currentSocPct, night.avgPct);
    let status = "ready";
    if (night.validNights < constants_1.MIN_VALID_NIGHTS && rates.avgChargeRatePctH === null) {
        status = "insufficient_data";
    }
    else if (night.validNights < constants_1.MIN_VALID_NIGHTS) {
        status = "partial";
    }
    const hasRates = (rates.avgChargeRatePctH !== null || rates.avgDischargeRatePctH !== null) &&
        params.socPoints.length >= constants_1.MIN_RATE_SAMPLES;
    if (status === "ready" && !hasRates && night.validNights < constants_1.MIN_VALID_NIGHTS) {
        status = "insufficient_data";
    }
    return {
        status,
        sampleDays: params.sampleDays,
        avgNightDischargePct: night.avgPct,
        avgNightDischargeKwh: night.avgKwh,
        avgChargeRatePctH: rates.avgChargeRatePctH,
        avgDischargeRatePctH: rates.avgDischargeRatePctH,
        avgChargePowerW: powerStats.avgChargePowerW,
        avgDischargePowerW: powerStats.avgDischargePowerW,
        maxChargePowerW: powerStats.maxChargePowerW,
        maxDischargePowerW: powerStats.maxDischargePowerW,
        lastFullCharge,
        daysSinceFull: topoff.daysSinceFull,
        secondsSinceFullCharge: params.secondsSinceFull,
        fullChargeSource,
        topoffIntervalDays: params.cfg.topoffIntervalDays,
        topoffDaysRemaining: topoff.topoffDaysRemaining,
        topoffDue: topoff.topoffDue,
        estimatedRuntimeDays,
        currentSocPct: params.currentSocPct,
        capacityKwh: params.capacityKwh,
        sourceSocStateId: params.sourceSocStateId,
        sourcePowerStateId: params.sourcePowerStateId,
        lastError: "",
    };
}
exports.computeBatteryRuntimeLearning = computeBatteryRuntimeLearning;
function noSourceResult(cfg) {
    return {
        status: "no_source",
        sampleDays: 0,
        avgNightDischargePct: null,
        avgNightDischargeKwh: null,
        avgChargeRatePctH: null,
        avgDischargeRatePctH: null,
        avgChargePowerW: null,
        avgDischargePowerW: null,
        maxChargePowerW: null,
        maxDischargePowerW: null,
        lastFullCharge: null,
        daysSinceFull: null,
        secondsSinceFullCharge: null,
        fullChargeSource: null,
        topoffIntervalDays: cfg.topoffIntervalDays,
        topoffDaysRemaining: null,
        topoffDue: null,
        estimatedRuntimeDays: null,
        currentSocPct: null,
        capacityKwh: null,
        sourceSocStateId: "",
        sourcePowerStateId: "",
        lastError: "Keine SOC-Quelle — Admin-State oder addons.battery.mapping.soc_pct konfigurieren.",
    };
}
exports.noSourceResult = noSourceResult;
function disabledResult(cfg) {
    return {
        ...noSourceResult(cfg),
        status: "disabled",
        lastError: "Battery Runtime Learning in Admin deaktiviert.",
    };
}
exports.disabledResult = disabledResult;
function errorResult(message, cfg, sources) {
    return {
        ...noSourceResult(cfg),
        status: "error",
        sourceSocStateId: sources.soc,
        sourcePowerStateId: sources.power,
        lastError: message,
    };
}
exports.errorResult = errorResult;
