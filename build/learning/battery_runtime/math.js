"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.disabledResult = exports.noSourceResult = exports.withPowerDiagnostics = exports.computeBatteryRuntimeLearning = exports.estimateRuntimeDays = exports.computeTopoffStatus = exports.calendarDaysSince = exports.findLastFullCharge = exports.resolveLastFullCharge = exports.fullChargeFromSecondsSince = exports.computePowerStats = exports.computeSocRates = exports.computeNightConsumption = exports.computeNightDischarges = exports.expandBridgeWithClockEnvelope = void 0;
const constants_1 = require("./constants");
const night_bridge_1 = require("./night_bridge");
const time_1 = require("./time");
const reserve_1 = require("./reserve");
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
 * Uhr-/Astro-Hülle nur bei echten Astro-Zeiten (Sonnenuntergang/-aufgang).
 * Feste 22–06 werden bewusst NICHT verwendet — Sommer-/Winterdifferenz wäre zu groß
 * und würde die dynamische PV-/Batterie-Brücke verfälschen.
 */
function clockEnvelopeForEvening(eveningDateKey, _nightStart, _nightEnd, astroDaily) {
    if (!astroDaily?.startByDate.has(eveningDateKey))
        return null;
    const startTime = astroDaily.startByDate.get(eveningDateKey);
    const parts = eveningDateKey.split("-").map((x) => parseInt(x, 10));
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n)))
        return null;
    const [y, m, d] = parts;
    const nextKey = (0, time_1.localDateKey)(new Date(y, m - 1, d + 1));
    const endTime = astroDaily.endByDate.get(nextKey) ?? astroDaily.startByDate.get(nextKey);
    if (!endTime)
        return null;
    const startTs = (0, time_1.timestampAtLocalTime)(eveningDateKey, startTime.hour, startTime.minute);
    const endTs = (0, time_1.timestampAtLocalTime)(nextKey, endTime.hour, endTime.minute);
    if (!(endTs > startTs))
        return null;
    return { startTs, endTs };
}
/** Beobachtungsfenster = dynamische Brücke ∪ Astro-Hülle (nur wenn Astro konfiguriert). */
function expandBridgeWithClockEnvelope(bridge, nightStart, nightEnd, astroDaily) {
    const clock = clockEnvelopeForEvening(bridge.eveningDateKey, nightStart, nightEnd, astroDaily);
    if (!clock)
        return { startTs: bridge.startTs, endTs: bridge.endTs };
    const startTs = Math.min(bridge.startTs, clock.startTs);
    const endTs = Math.max(bridge.endTs, clock.endTs);
    if (!(endTs > startTs))
        return { startTs: bridge.startTs, endTs: bridge.endTs };
    const durH = (endTs - startTs) / constants_1.MS_PER_HOUR;
    if (durH < 4 || durH > 20)
        return { startTs: bridge.startTs, endTs: bridge.endTs };
    return { startTs, endTs };
}
exports.expandBridgeWithClockEnvelope = expandBridgeWithClockEnvelope;
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
    function scoreWindows(windows) {
        const pctDischarges = [];
        const kwhDischarges = [];
        const weights = [];
        const bridgeHours = [];
        for (const w of windows) {
            const obs = expandBridgeWithClockEnvelope(w, params.nightStart, params.nightEnd, params.astroDaily);
            /** Abend: SOC bei/vor Beobachtungsstart; Morgen: Tiefstwert im erweiterten Fenster. */
            const socStart = (0, night_bridge_1.findSocAtOrBefore)(params.socPoints, obs.startTs, maxDelta) ??
                findNearestSoc(params.socPoints, obs.startTs, maxDelta);
            const socEnd = (0, night_bridge_1.findMinSocInRange)(params.socPoints, obs.startTs, obs.endTs) ??
                (0, night_bridge_1.findSocAtOrBefore)(params.socPoints, obs.endTs, maxDelta) ??
                findNearestSoc(params.socPoints, obs.endTs, maxDelta);
            if (socStart === null || socEnd === null)
                continue;
            const dischargePct = socStart - socEnd;
            if (dischargePct <= 0 || dischargePct > 65)
                continue;
            const ageDays = Math.max(0, (nowMs - w.endTs) / constants_1.MS_PER_DAY);
            const weight = (0, night_bridge_1.recencyWeight)(ageDays);
            pctDischarges.push(round2(dischargePct));
            weights.push(weight);
            /** Brückendauer bleibt die dynamische Erkennung (Diagnose), nicht die Uhr-Hülle. */
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
    function isDynamicMethod(m) {
        return m === "pv_house" || m === "battery_discharge";
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
    /**
     * Dynamische Brücken (PV/Haus, Batterie) haben absolute Priorität vor Astro/fixed_clock.
     * Night-Count-Dominanz gilt nur innerhalb derselben Klasse — sonst überschreibt
     * fixed_clock (jede SOC-Nacht 22–06) jede saisonale PV-Brücke.
     */
    function prefer(a, b) {
        const aDyn = isDynamicMethod(a.method);
        const bDyn = isDynamicMethod(b.method);
        const aOk = a.validNights >= constants_1.MIN_VALID_NIGHTS;
        const bOk = b.validNights >= constants_1.MIN_VALID_NIGHTS;
        if (aDyn !== bDyn) {
            if (aDyn && aOk)
                return true;
            if (bDyn && bOk)
                return false;
            if (aDyn !== bDyn)
                return aDyn;
        }
        if (aOk && bOk) {
            if (aDyn && bDyn) {
                const aDominates = a.validNights >= b.validNights * 2 && a.validNights >= b.validNights + 3;
                const bDominates = b.validNights >= a.validNights * 2 && b.validNights >= a.validNights + 3;
                if (aDominates !== bDominates)
                    return aDominates;
            }
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
    function pickBest(list) {
        let best = null;
        for (const c of list) {
            const scored = { ...scoreWindows(c.windows), method: c.method };
            if (!best || prefer(scored, best))
                best = scored;
        }
        return best;
    }
    /*
     * Phase 1: nur dynamische Kandidaten. Feste Uhr / Astro erst, wenn keine dynamische
     * Methode ≥ MIN_VALID_NIGHTS liefert — nie als Konkurrent um Nachtanzahl.
     */
    let best = pickBest(candidates);
    if (!best || best.validNights < constants_1.MIN_VALID_NIGHTS) {
        const clockWindows = clockAstroWindows(params.socPoints, params.nightStart, params.nightEnd, params.astroDaily);
        if (clockWindows.length > 0) {
            const clockCandidate = {
                method: clockWindows[0].method,
                windows: clockWindows,
            };
            const withClock = [...candidates, clockCandidate];
            const clockBest = pickBest(withClock);
            if (clockBest && (!best || prefer(clockBest, best))) {
                best = clockBest;
                if (!candidates.some((c) => c.method === clockCandidate.method)) {
                    candidates.push(clockCandidate);
                }
            }
        }
    }
    if (!best) {
        return {
            avgPct: null,
            avgKwh: null,
            validNights: 0,
            method: "none",
            avgBridgeHours: null,
            windows: [],
        };
    }
    const bestWindows = candidates.find((c) => c.method === best.method)?.windows ?? [];
    return {
        avgPct: best.avgPct,
        avgKwh: best.avgKwh,
        validNights: best.validNights,
        method: best.method,
        avgBridgeHours: best.avgBridgeHours,
        windows: bestWindows,
    };
}
exports.computeNightDischarges = computeNightDischarges;
/**
 * Nachtenergie-Bedarf für die dynamische Reserve.
 *
 * Pro Brückenfenster (dieselbe Abgrenzung wie Entladung); Beobachtung nur bei
 * konfiguriertem Astro um Sonnenuntergang/-aufgang erweitert — nie feste 22–06.
 *   houseKwh           — Hauslast-Integration
 *   batteryDischargeKwh — integrierte Batterie-Entladeleistung
 *   socDeltaKwh        — SOC-Start − SOC-Tief × Kapazität
 *
 * Maßgeblich: max der verfügbaren Signale (keine systematische Unterschätzung durch
 * Haus-only). Sondernächte:
 * - SOC steigt (Netz-/PV-Ladung) → ausgeschlossen
 * - SOC-Abfall > 65 % → ausgeschlossen (Ausreißer)
 * - Hauslast >> Batterie-/SOC-Signale (EV/Heizstab aus Netz) → Batteriebedarf, nicht Haus
 * - nach Aggregation: Werte > 2.5× Median werden verworfen
 *
 * `houseAvgKwh` bleibt separat für Grid-Import-Diagnose.
 */
function computeNightConsumption(params) {
    if (params.windows.length === 0) {
        return { avgKwh: null, houseAvgKwh: null, validNights: 0 };
    }
    const nowMs = params.nowMs ?? Date.now();
    const maxDelta = 3 * constants_1.MS_PER_HOUR;
    const housePoints = params.housePowerPoints ?? [];
    const batteryPoints = params.batteryPowerPoints ?? [];
    const socPoints = params.socPoints ?? [];
    const capacity = params.capacityKwh ?? null;
    const nightStart = params.nightStart ?? "22:00";
    const nightEnd = params.nightEnd ?? "06:00";
    const needValues = [];
    const houseValues = [];
    const needWeights = [];
    const houseWeights = [];
    for (const w of params.windows) {
        const obs = expandBridgeWithClockEnvelope(w, nightStart, nightEnd, params.astroDaily);
        const ageDays = Math.max(0, (nowMs - w.endTs) / constants_1.MS_PER_DAY);
        const weight = (0, night_bridge_1.recencyWeight)(ageDays);
        const houseKwh = housePoints.length > 0 ? (0, night_bridge_1.integratePowerKwh)(housePoints, obs.startTs, obs.endTs) : null;
        const batKwh = batteryPoints.length > 0
            ? (0, night_bridge_1.integrateDischargeKwh)(batteryPoints, obs.startTs, obs.endTs)
            : null;
        let socDeltaKwh = null;
        let dischargePct = null;
        if (socPoints.length > 0 && capacity !== null && capacity > 0) {
            const socStart = (0, night_bridge_1.findSocAtOrBefore)(socPoints, obs.startTs, maxDelta) ??
                findNearestSoc(socPoints, obs.startTs, maxDelta);
            const socEnd = (0, night_bridge_1.findMinSocInRange)(socPoints, obs.startTs, obs.endTs) ??
                (0, night_bridge_1.findSocAtOrBefore)(socPoints, obs.endTs, maxDelta) ??
                findNearestSoc(socPoints, obs.endTs, maxDelta);
            if (socStart !== null && socEnd !== null) {
                dischargePct = socStart - socEnd;
                if (dischargePct > 0 && dischargePct <= 65) {
                    socDeltaKwh = round3((dischargePct / 100) * capacity);
                }
            }
        }
        if (houseKwh !== null && houseKwh > 0) {
            houseValues.push(houseKwh);
            houseWeights.push(weight);
        }
        /*
         * Sondernacht: Batterie wurde geladen (SOC steigt) und keine nennenswerte Entladung —
         * keine Reserve-Lernprobe (Netzladung / PV-Rest).
         */
        const batteryDelivered = (socDeltaKwh !== null && socDeltaKwh > 0) || (batKwh !== null && batKwh > 0.05);
        if (dischargePct !== null && dischargePct <= 0 && !batteryDelivered) {
            continue;
        }
        if (dischargePct !== null && dischargePct > 65) {
            continue;
        }
        const batterySignals = [];
        if (socDeltaKwh !== null && socDeltaKwh > 0)
            batterySignals.push(socDeltaKwh);
        if (batKwh !== null && batKwh > 0)
            batterySignals.push(batKwh);
        const batteryNeed = batterySignals.length > 0 ? Math.max(...batterySignals) : null;
        let nightNeed = null;
        if (batteryNeed !== null && houseKwh !== null && houseKwh > 0) {
            /*
             * EV/Heizstab/Klima aus dem Netz blähen die Hauslast auf, ohne Batteriereserve zu
             * brauchen — dann Batteriebedarf, nicht Hauslast.
             */
            if (houseKwh > batteryNeed * 1.75) {
                nightNeed = batteryNeed;
            }
            else {
                nightNeed = Math.max(batteryNeed, houseKwh);
            }
        }
        else if (batteryNeed !== null) {
            nightNeed = batteryNeed;
        }
        else if (houseKwh !== null && houseKwh > 0) {
            nightNeed = houseKwh;
        }
        if (nightNeed === null || !(nightNeed > 0))
            continue;
        needValues.push(round3(nightNeed));
        needWeights.push(weight);
    }
    const filtered = trimNightNeedOutliers(needValues, needWeights);
    return {
        avgKwh: (0, night_bridge_1.weightedAverage)(filtered.values, filtered.weights),
        houseAvgKwh: (0, night_bridge_1.weightedAverage)(houseValues, houseWeights),
        validNights: filtered.values.length,
    };
}
exports.computeNightConsumption = computeNightConsumption;
/** Verwirft Ausreißer oberhalb von 2.5× Median (Sondernächte mit extremem Verbrauch). */
function trimNightNeedOutliers(values, weights) {
    if (values.length < 4)
        return { values, weights };
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    if (!(median > 0))
        return { values, weights };
    const cap = median * 2.5;
    const outV = [];
    const outW = [];
    for (let i = 0; i < values.length; i++) {
        if (values[i] <= cap) {
            outV.push(values[i]);
            outW.push(weights[i]);
        }
    }
    return outV.length > 0 ? { values: outV, weights: outW } : { values, weights };
}
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
    const nightConsumption = computeNightConsumption({
        windows: night.windows,
        housePowerPoints: params.housePowerPoints ?? [],
        batteryPowerPoints: params.powerPoints,
        socPoints: params.socPoints,
        capacityKwh: params.capacityKwh,
        nightStart: params.cfg.nightStart,
        nightEnd: params.cfg.nightEnd,
        astroDaily: params.astroDaily,
        nowMs: params.now.getTime(),
    });
    /*
     * predictedNightConsumptionKwh = einheitlicher Nachtenergie-Bedarf (max aus Haus /
     * Batterie-Entladung / SOC-Delta) — führende Learning-Basis für die Planner-Reserve.
     * avg_night_load_w wird daraus abgeleitet (predicted / bridgeHours), damit die drei
     * Nacht-Kennzahlen (Stunden × Last ≈ Bedarf) algebraisch zusammenpassen.
     * houseAvgKwh bleibt nur für die Netzbezug-Diagnose.
     */
    const predictedNightConsumptionKwh = nightConsumption.avgKwh;
    const houseAvgKwh = nightConsumption.houseAvgKwh;
    /*
     * Netzbezug in der Nacht ≈ Hausverbrauch minus dem, was die Batterie davon deckte —
     * Diagnose, keine dritte Messreihe.
     */
    const predictedNightGridImportKwh = houseAvgKwh !== null && night.avgKwh !== null
        ? round3(Math.max(0, houseAvgKwh - night.avgKwh))
        : null;
    const avgNightLoadW = predictedNightConsumptionKwh !== null &&
        night.avgBridgeHours !== null &&
        night.avgBridgeHours > 0
        ? round2((predictedNightConsumptionKwh / night.avgBridgeHours) * 1000)
        : null;
    const reserve = (0, reserve_1.resolveRequiredSocAtPvEndPct)({
        predictedNightConsumptionKwh,
        usableCapacityKwh: params.capacityKwh,
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
        predictedNightConsumptionKwh,
        nightConsumptionValidNights: nightConsumption.validNights,
        predictedNightGridImportKwh,
        avgNightLoadW,
        requiredSocAtPvEndPct: reserve.requiredSocAtPvEndPct,
        requiredNightReserveKwh: reserve.requiredReserveKwh,
        nightReserveReasonDe: reserve.reasonDe,
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
        predictedNightConsumptionKwh: null,
        nightConsumptionValidNights: 0,
        predictedNightGridImportKwh: null,
        avgNightLoadW: null,
        requiredSocAtPvEndPct: null,
        requiredNightReserveKwh: null,
        nightReserveReasonDe: "Keine Datenquelle — Reserve nicht berechenbar.",
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
