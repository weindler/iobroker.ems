"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.disabledResult = exports.noSourceResult = exports.withPowerDiagnostics = exports.computeBatteryRuntimeLearning = exports.estimateRuntimeDays = exports.computeTopoffStatus = exports.calendarDaysSince = exports.findLastFullCharge = exports.resolveLastFullCharge = exports.fullChargeFromSecondsSince = exports.computePowerStats = exports.computeSocRates = exports.computeNightDischarges = void 0;
const constants_1 = require("./constants");
const night_bridge_1 = require("./night_bridge");
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
    return (0, night_bridge_1.findNearestSoc)(points, targetTs, maxDeltaMs);
}
function clockAstroWindows(socPoints, nightStart, nightEnd, astroDaily) {
    const fixedStart = (0, time_1.parseTimeHHMM)(nightStart);
    const fixedEnd = (0, time_1.parseTimeHHMM)(nightEnd);
    if (!fixedStart || !fixedEnd || socPoints.length === 0)
        return [];
    const dateKeys = [...new Set(socPoints.map((p) => (0, time_1.localDateKey)(new Date(p.ts))))].sort();
    const out = [];
    for (let i = 0; i < dateKeys.length - 1; i++) {
        const dayKey = dateKeys[i];
        const nextKey = dateKeys[i + 1];
        const startTime = astroDaily?.startByDate.get(dayKey) ?? fixedStart;
        const endTime = astroDaily?.endByDate.get(nextKey) ?? fixedEnd;
        const startTs = (0, time_1.timestampAtLocalTime)(dayKey, startTime.hour, startTime.minute);
        const endTs = (0, time_1.timestampAtLocalTime)(nextKey, endTime.hour, endTime.minute);
        if (endTs <= startTs)
            continue;
        out.push({
            startTs,
            endTs,
            eveningDateKey: dayKey,
            method: astroDaily?.startByDate.has(dayKey) ? "astro" : "fixed_clock",
        });
    }
    return out;
}
/**
 * Nachtentladung über Brückenfenster (PV/Haus, Batterie, Astro oder feste Uhr).
 * Alle Kandidaten werden bewertet — dünnes pv_house (1 Nacht / 1 kWh) darf die
 * belastbare battery_discharge-Serie nicht überschreiben.
 */
function computeNightDischarges(params) {
    const maxDelta = 3 * constants_1.MS_PER_HOUR;
    const flutterMs = params.flutterMs ?? night_bridge_1.DEFAULT_NIGHT_BRIDGE_FLUTTER_MS;
    const nowMs = params.nowMs ?? Date.now();
    const candidates = [];
    const pv = params.pvPowerPoints ?? [];
    const house = params.housePowerPoints ?? [];
    if (pv.length > 0 && house.length > 0) {
        const net = (0, night_bridge_1.buildPvHouseNetSeries)(pv, house);
        const medianGap = (() => {
            const ts = net.map((p) => p.ts).sort((a, b) => a - b);
            const gaps = [];
            for (let i = 1; i < Math.min(ts.length, 40); i++)
                gaps.push(ts[i] - ts[i - 1]);
            if (gaps.length === 0)
                return 0;
            gaps.sort((a, b) => a - b);
            return gaps[Math.floor(gaps.length / 2)];
        })();
        const pvFlutter = medianGap >= 40 * 60_000 ? constants_1.MS_PER_HOUR : flutterMs;
        const windows = (0, night_bridge_1.findPvHouseNightBridges)(net, {
            flutterMs: pvFlutter,
            method: "pv_house",
            bucketMs: medianGap >= 40 * 60_000 ? constants_1.MS_PER_HOUR : undefined,
        });
        if (windows.length > 0) {
            candidates.push({ method: "pv_house", windows });
        }
    }
    if ((params.batteryPowerPoints?.length ?? 0) > 0) {
        const net = (0, night_bridge_1.buildBatteryDeficitSeries)(params.batteryPowerPoints);
        const windows = (0, night_bridge_1.findPvHouseNightBridges)(net, {
            flutterMs,
            method: "battery_discharge",
        });
        if (windows.length > 0) {
            candidates.push({ method: "battery_discharge", windows });
        }
    }
    {
        const windows = clockAstroWindows(params.socPoints, params.nightStart, params.nightEnd, params.astroDaily);
        if (windows.length > 0) {
            candidates.push({ method: windows[0].method, windows });
        }
    }
    function scoreWindows(windows) {
        const pctDischarges = [];
        const kwhDischarges = [];
        const weights = [];
        const bridgeHours = [];
        for (const w of windows) {
            const socStart = findNearestSoc(params.socPoints, w.startTs, maxDelta);
            const socEnd = findNearestSoc(params.socPoints, w.endTs, maxDelta);
            if (socStart === null || socEnd === null)
                continue;
            const dischargePct = socStart - socEnd;
            if (dischargePct <= 0 || dischargePct > 65)
                continue;
            const ageDays = Math.max(0, (nowMs - w.endTs) / constants_1.MS_PER_DAY);
            const weight = (0, night_bridge_1.recencyWeight)(ageDays);
            pctDischarges.push(round2(dischargePct));
            weights.push(weight);
            bridgeHours.push((w.endTs - w.startTs) / constants_1.MS_PER_HOUR);
            if (params.capacityKwh !== null) {
                kwhDischarges.push(round3((dischargePct / 100) * params.capacityKwh));
            }
        }
        return {
            avgPct: (0, night_bridge_1.weightedAverage)(pctDischarges, weights),
            avgKwh: params.capacityKwh !== null && kwhDischarges.length === weights.length
                ? (0, night_bridge_1.weightedAverage)(kwhDischarges, weights)
                : null,
            validNights: pctDischarges.length,
            avgBridgeHours: average(bridgeHours),
        };
    }
    function methodRank(m) {
        switch (m) {
            case "pv_house":
                return 0;
            case "battery_discharge":
                return 1;
            case "astro":
                return 2;
            default:
                return 3;
        }
    }
    /** belastbar bevorzugen; bei Gleichstand pv_house vor battery_discharge. */
    function prefer(a, b) {
        const aOk = a.validNights >= constants_1.MIN_VALID_NIGHTS;
        const bOk = b.validNights >= constants_1.MIN_VALID_NIGHTS;
        if (aOk && bOk) {
            if (a.method !== b.method)
                return methodRank(a.method) < methodRank(b.method);
            return a.validNights >= b.validNights;
        }
        if (aOk !== bOk)
            return aOk;
        if (a.validNights !== b.validNights)
            return a.validNights > b.validNights;
        return methodRank(a.method) < methodRank(b.method);
    }
    let best = null;
    for (const c of candidates) {
        const scored = { ...scoreWindows(c.windows), method: c.method };
        if (!best || prefer(scored, best)) {
            best = scored;
        }
    }
    if (!best) {
        return {
            avgPct: null,
            avgKwh: null,
            validNights: 0,
            method: "none",
            avgBridgeHours: null,
        };
    }
    return {
        avgPct: best.avgPct,
        avgKwh: best.avgKwh,
        validNights: best.validNights,
        method: best.method,
        avgBridgeHours: best.avgBridgeHours,
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
        pvPowerPoints: params.pvPowerPoints,
        housePowerPoints: params.housePowerPoints,
        batteryPowerPoints: params.powerPoints,
        nowMs: params.now.getTime(),
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
        powerHistoryRawRows: null,
        powerHistoryNormalizedRows: null,
        powerRawChargeSamples: null,
        powerRawDischargeSamples: null,
        powerHourlyChargePoints: null,
        powerHourlyDischargePoints: null,
        powerInvertApplied: null,
        powerInvertAuto: null,
        powerHistoryMode: "",
        nightBridgeMethod: night.method,
        avgNightBridgeHours: night.avgBridgeHours,
        nightBridgeValidNights: night.validNights,
    };
}
exports.computeBatteryRuntimeLearning = computeBatteryRuntimeLearning;
const EMPTY_POWER_DIAGNOSTICS = {
    powerHistoryRawRows: null,
    powerHistoryNormalizedRows: null,
    powerRawChargeSamples: null,
    powerRawDischargeSamples: null,
    powerHourlyChargePoints: null,
    powerHourlyDischargePoints: null,
    powerInvertApplied: null,
    powerInvertAuto: null,
    powerHistoryMode: "",
    nightBridgeMethod: "none",
    avgNightBridgeHours: null,
    nightBridgeValidNights: 0,
};
function withPowerDiagnostics(result, meta) {
    if (!meta)
        return result;
    return {
        ...result,
        powerHistoryRawRows: meta.rawRows,
        powerHistoryNormalizedRows: meta.normalizedRows,
        powerRawChargeSamples: meta.rawChargeSamples,
        powerRawDischargeSamples: meta.rawDischargeSamples,
        powerHourlyChargePoints: meta.hourlyChargePoints,
        powerHourlyDischargePoints: meta.hourlyDischargePoints,
        powerInvertApplied: meta.powerInvert,
        powerInvertAuto: meta.powerInvertAuto,
        powerHistoryMode: meta.powerHistoryMode,
    };
}
exports.withPowerDiagnostics = withPowerDiagnostics;
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
        ...EMPTY_POWER_DIAGNOSTICS,
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
