"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorResult = exports.invalidConfigResult = exports.disabledResult = exports.noSourceResult = exports.computeThermalRuntimeLearning = exports.estimatedEmptyAtIso = exports.estimateRemainingHours = exports.groupByDayType = exports.groupBySeason = exports.estimateActiveCoolingRateCPerH = exports.collectCoolingSegments = exports.detectRuntimeCycles = exports.summarizeTempHistory = exports.median = exports.average = void 0;
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
const MIN_COOLING_DROP_C = 1;
/** Mindest-Abkühlung eines echten Fall-Segments — schließt Plateaus/Nachheizen aus. */
const MIN_ACTIVE_SEGMENT_DROP_C = 2;
/** Rausch-Toleranz: kleiner Anstieg fragmentiert ein Fall-Segment nicht. */
const ACTIVE_NOISE_C = 0.3;
/** Temperatur steigt wieder über Peak → Überschuss-/Nachheizen, Segment abbrechen. */
const HEATING_RESUME_MARGIN_C = 0.5;
/** Kurzdiagnose für Logs — warum keine Zyklen erkannt wurden. */
function summarizeTempHistory(points, emptyThresholdC) {
    let minC = null;
    let maxC = null;
    let pointsAboveFloor = 0;
    let pointsAtOrBelowFloor = 0;
    for (const p of points) {
        if (minC === null || p.tempC < minC)
            minC = p.tempC;
        if (maxC === null || p.tempC > maxC)
            maxC = p.tempC;
        if (p.tempC > emptyThresholdC)
            pointsAboveFloor++;
        else
            pointsAtOrBelowFloor++;
    }
    return { minC, maxC, pointsAboveFloor, pointsAtOrBelowFloor };
}
exports.summarizeTempHistory = summarizeTempHistory;
/**
 * Erkennt Abkühl-Segmente: lokaler Peak (Überschuss-/Pufferstand) → Betriebs-Untergrenze.
 * Kein fester „Voll bei 60 °C“-Start — Start kann überall im Betriebsband liegen (z. B. 52–59 °C).
 */
function detectRuntimeCycles(points, cfg) {
    const cycles = [];
    const floor = cfg.emptyThresholdC;
    if (points.length < 2) {
        return cycles;
    }
    let i = 0;
    while (i < points.length - 1) {
        while (i < points.length && points[i].tempC <= floor) {
            i++;
        }
        if (i >= points.length - 1) {
            break;
        }
        let peakIdx = i;
        let peakTemp = points[i].tempC;
        while (i + 1 < points.length && points[i + 1].tempC >= points[i].tempC - 0.05) {
            i++;
            if (points[i].tempC > peakTemp) {
                peakTemp = points[i].tempC;
                peakIdx = i;
            }
        }
        if (peakTemp <= floor + 0.1) {
            i++;
            continue;
        }
        let endIdx = -1;
        let resumeIdx = -1;
        for (let j = peakIdx + 1; j < points.length; j++) {
            const t = points[j].tempC;
            if (t <= floor) {
                endIdx = j;
                break;
            }
            if (t > peakTemp + HEATING_RESUME_MARGIN_C) {
                resumeIdx = j;
                break;
            }
        }
        if (endIdx > peakIdx) {
            const startP = points[peakIdx];
            const endP = points[endIdx];
            const runtimeHours = (endP.ts - startP.ts) / constants_1.MS_PER_HOUR;
            const dropC = startP.tempC - endP.tempC;
            if (runtimeHours >= cfg.minRuntimeHours &&
                runtimeHours <= cfg.maxRuntimeHours &&
                dropC >= MIN_COOLING_DROP_C) {
                const coolingRateCPerH = dropC / runtimeHours;
                if (Number.isFinite(coolingRateCPerH) && coolingRateCPerH > 0) {
                    const startDate = new Date(startP.ts);
                    cycles.push({
                        startTs: startP.ts,
                        endTs: endP.ts,
                        startTempC: round2(startP.tempC),
                        endTempC: round2(endP.tempC),
                        runtimeHours: round3(runtimeHours),
                        coolingRateCPerH: round3(coolingRateCPerH),
                        season: (0, time_1.seasonFromDate)(startDate),
                        dayType: (0, time_1.dayTypeFromWeekday)((0, time_1.weekdayFromDate)(startDate)),
                    });
                }
            }
            i = endIdx + 1;
        }
        else if (resumeIdx >= 0) {
            i = resumeIdx;
        }
        else {
            i = peakIdx + 1;
        }
    }
    return cycles;
}
exports.detectRuntimeCycles = detectRuntimeCycles;
/**
 * Sammelt echte Abkühl-Segmente (Peak → Tal) aus dem Verlauf.
 * Plateaus und Wiederaufheizen (Sonne/Überschuss) trennen Segmente und zählen NICHT
 * als Kühlung — so entsteht die natürliche No-Heat-Rate statt eines gemischten Trends.
 */
function collectCoolingSegments(points, minRuntimeHours) {
    const segments = [];
    if (points.length < 2) {
        return segments;
    }
    let peakIdx = 0;
    let troughIdx = 0;
    const tryPush = (pIdx, tIdx) => {
        if (tIdx <= pIdx) {
            return;
        }
        const dropC = points[pIdx].tempC - points[tIdx].tempC;
        const hours = (points[tIdx].ts - points[pIdx].ts) / constants_1.MS_PER_HOUR;
        if (dropC < MIN_ACTIVE_SEGMENT_DROP_C || hours < minRuntimeHours) {
            return;
        }
        const rateCPerH = dropC / hours;
        if (Number.isFinite(rateCPerH) && rateCPerH > 0) {
            segments.push({ dropC: round2(dropC), hours: round3(hours), rateCPerH: round3(rateCPerH) });
        }
    };
    for (let i = 1; i < points.length; i++) {
        const t = points[i].tempC;
        if (troughIdx === peakIdx && t >= points[peakIdx].tempC) {
            // Noch am Aufheizen vor dem ersten Abfall → Peak nachziehen
            peakIdx = i;
            troughIdx = i;
            continue;
        }
        if (t <= points[troughIdx].tempC) {
            troughIdx = i;
            continue;
        }
        if (t > points[troughIdx].tempC + ACTIVE_NOISE_C) {
            // Wiederaufheizen → aktuelles Fall-Segment abschließen, neuer Peak
            tryPush(peakIdx, troughIdx);
            peakIdx = i;
            troughIdx = i;
        }
    }
    tryPush(peakIdx, troughIdx);
    return segments;
}
exports.collectCoolingSegments = collectCoolingSegments;
/**
 * Natürliche Kühlrate (°C/h) aus echten Fall-Segmenten — Median, robust gegen
 * Plateaus und einzelne Ausreißer. Untergrenze wird hier nicht gebraucht, da nur
 * die Steigung der Abkühlung zählt (nicht das absolute Niveau).
 */
function estimateActiveCoolingRateCPerH(points, cfg) {
    const segments = collectCoolingSegments(points, cfg.minRuntimeHours);
    if (segments.length === 0) {
        return null;
    }
    const sorted = segments.map((s) => s.rateCPerH).sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const rate = sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
    return rate > 0 ? round3(rate) : null;
}
exports.estimateActiveCoolingRateCPerH = estimateActiveCoolingRateCPerH;
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
    if (coolingRateCPerHAvg !== null && coolingRateCPerHAvg > 0) {
        return round3((currentTempC - emptyThresholdC) / coolingRateCPerHAvg);
    }
    // Fallback: lineare Skalierung im Betriebsband, wenn nur Median-Laufzeit bekannt
    if (typicalRuntimeHours !== null &&
        fullThresholdC > emptyThresholdC &&
        currentTempC > emptyThresholdC) {
        const frac = (currentTempC - emptyThresholdC) / (fullThresholdC - emptyThresholdC);
        return round3(typicalRuntimeHours * Math.min(1, Math.max(0, frac)));
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
    const { cycles, currentTempC, cfg, sourceStateId, now, activeCoolingRateCPerH = null } = params;
    const configValid = cfg.fullThresholdC > cfg.emptyThresholdC;
    if (!configValid) {
        return invalidConfigResult(sourceStateId);
    }
    const runtimes = cycles.map((c) => c.runtimeHours);
    const rates = cycles.map((c) => c.coolingRateCPerH);
    const runtimeHoursAvg = average(runtimes);
    const runtimeHoursMedian = median(runtimes);
    const coolingRateCPerHAvg = average(rates);
    const coolingRateForEstimate = coolingRateCPerHAvg ?? activeCoolingRateCPerH;
    const remaining = estimateRemainingHours({
        currentTempC,
        fullThresholdC: cfg.fullThresholdC,
        emptyThresholdC: cfg.emptyThresholdC,
        typicalRuntimeHours: runtimeHoursMedian ?? runtimeHoursAvg,
        coolingRateCPerHAvg: coolingRateForEstimate,
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
