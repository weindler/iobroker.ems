"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePvBias = exports.correctForecastKwh = exports.confidencePct = exports.stdDevPct = exports.meanBiasPct = exports.dayBiasPct = void 0;
/** Tagesbias in %; forecast ≤ 0 oder ungültige Werte → Tag ignorieren (null). */
function dayBiasPct(actualKwh, forecastKwh) {
    if (!Number.isFinite(actualKwh) || !Number.isFinite(forecastKwh) || forecastKwh <= 0) {
        return null;
    }
    return ((actualKwh - forecastKwh) / forecastKwh) * 100;
}
exports.dayBiasPct = dayBiasPct;
function meanBiasPct(pairs) {
    const biases = [];
    for (const p of pairs) {
        const b = dayBiasPct(p.actualKwh, p.forecastKwh);
        if (b !== null) {
            biases.push(b);
        }
    }
    if (biases.length === 0) {
        return { biasPct: null, sampleDays: 0 };
    }
    const sum = biases.reduce((a, b) => a + b, 0);
    return { biasPct: sum / biases.length, sampleDays: biases.length };
}
exports.meanBiasPct = meanBiasPct;
function stdDevPct(values) {
    if (values.length < 2) {
        return null;
    }
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
    return Math.sqrt(variance);
}
exports.stdDevPct = stdDevPct;
/**
 * Confidence sinkt bei wenig Historie, hoher Streuung und Lücken im 30-Tage-Fenster.
 * Skala orientiert sich an den Vertrags-Richtwerten (0–95 %).
 */
function confidencePct(sampleDays30, sampleDays7, stdDevBias) {
    let base = 0;
    if (sampleDays30 >= 30) {
        base = 90;
    }
    else if (sampleDays30 >= 15) {
        base = 82;
    }
    else if (sampleDays30 >= 7) {
        base = 68;
    }
    else if (sampleDays30 >= 3) {
        base = 50;
    }
    else if (sampleDays30 >= 1) {
        base = 28;
    }
    if (sampleDays7 < 3) {
        base = Math.min(base, 35);
    }
    else if (sampleDays7 < 7 && base > 60) {
        base = 60;
    }
    const gapRatio = sampleDays30 > 0 ? 1 - sampleDays30 / 30 : 1;
    base = base * (1 - gapRatio * 0.35);
    if (stdDevBias !== null) {
        if (stdDevBias > 50) {
            base *= 0.55;
        }
        else if (stdDevBias > 30) {
            base *= 0.75;
        }
        else if (stdDevBias > 15) {
            base *= 0.9;
        }
    }
    if (sampleDays30 >= 30 && stdDevBias !== null && stdDevBias <= 15) {
        base = Math.min(95, base + 5);
    }
    return Math.round(Math.max(0, Math.min(95, base)));
}
exports.confidencePct = confidencePct;
/** Korrigierter Forecast = Rohforecast × (1 + bias/100). */
function correctForecastKwh(rawKwh, biasPct) {
    if (!Number.isFinite(rawKwh) || !Number.isFinite(biasPct)) {
        return null;
    }
    return rawKwh * (1 + biasPct / 100);
}
exports.correctForecastKwh = correctForecastKwh;
function computePvBias(pairs, rawTodayKwh, rawTomorrowKwh) {
    const todayPairs = pairs.filter((p) => p.dayOffset === 0);
    // Unvollständiger heutiger Tag verfälscht Mittelwerte — nur abgestellte Tage zählen.
    const last7 = pairs.filter((p) => p.dayOffset >= 1 && p.dayOffset <= 7);
    const last30 = pairs.filter((p) => p.dayOffset >= 1 && p.dayOffset <= 30);
    const todayBias = meanBiasPct(todayPairs);
    const bias7 = meanBiasPct(last7);
    const bias30 = meanBiasPct(last30);
    const biasValues30 = [];
    for (const p of last30) {
        const b = dayBiasPct(p.actualKwh, p.forecastKwh);
        if (b !== null) {
            biasValues30.push(b);
        }
    }
    const spread = stdDevPct(biasValues30);
    const conf = confidencePct(bias30.sampleDays, bias7.sampleDays, spread);
    const biasForToday = todayBias.biasPct;
    const biasForCorrection = bias7.biasPct ?? bias30.biasPct;
    const biasForTomorrow = bias7.biasPct ?? bias30.biasPct;
    const correctedToday = biasForCorrection !== null && rawTodayKwh !== null
        ? correctForecastKwh(rawTodayKwh, biasForCorrection)
        : null;
    const correctedTomorrow = biasForTomorrow !== null && rawTomorrowKwh !== null
        ? correctForecastKwh(rawTomorrowKwh, biasForTomorrow)
        : null;
    let status = "ready";
    let reason = "PV-Bias aus Historie berechnet.";
    if (bias30.sampleDays === 0) {
        status = "insufficient_data";
        reason = "Keine gültigen Ist/Forecast-Tagespaare in der Historie.";
    }
    else if (bias7.sampleDays < 3) {
        status = "insufficient_data";
        reason = `Nur ${bias7.sampleDays} gültige Tage in 7d — Confidence niedrig.`;
    }
    return {
        biasTodayPct: todayBias.biasPct,
        bias7dPct: bias7.biasPct,
        bias30dPct: bias30.biasPct,
        sampleDays7d: bias7.sampleDays,
        sampleDays30d: bias30.sampleDays,
        confidencePct: conf,
        correctedTodayKwh: correctedToday,
        correctedTomorrowKwh: correctedTomorrow,
        rawTodayKwh,
        rawTomorrowKwh,
        status,
        reason,
    };
}
exports.computePvBias = computePvBias;
