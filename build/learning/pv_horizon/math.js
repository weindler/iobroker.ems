"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePvHorizon = exports.horizonDayConfidencePct = exports.correctHorizonKwh = exports.effectiveBiasPct = void 0;
const constants_1 = require("./constants");
/** Effektiver Bias in % nach Tages-Gewichtung (Day1 = Index 1). */
function effectiveBiasPct(biasPct, dayIndex) {
    const weight = constants_1.PV_HORIZON_BIAS_WEIGHT_BY_DAY[dayIndex - 1] ?? constants_1.PV_HORIZON_BIAS_WEIGHT_BY_DAY.at(-1);
    return biasPct * weight;
}
exports.effectiveBiasPct = effectiveBiasPct;
/** Korrigierter Horizon-Wert = Rohforecast × (1 + effektiver Bias / 100). */
function correctHorizonKwh(rawKwh, biasPct, dayIndex) {
    const eff = effectiveBiasPct(biasPct, dayIndex);
    return rawKwh * (1 + eff / 100);
}
exports.correctHorizonKwh = correctHorizonKwh;
/** Confidence aus Phase-2A-Basis, linear abnehmend über die Tage. */
function horizonDayConfidencePct(baseConfidencePct, dayIndex) {
    const decay = constants_1.PV_HORIZON_CONFIDENCE_DECAY_PP_PER_DAY * (dayIndex - 1);
    return Math.round(Math.max(0, Math.min(95, baseConfidencePct - decay)));
}
exports.horizonDayConfidencePct = horizonDayConfidencePct;
function computePvHorizon(rawKwhByDay, biasPct, baseConfidencePct) {
    const days = [];
    let totalRaw = 0;
    let totalCorrected = 0;
    let hasRawSum = false;
    let hasCorrectedSum = false;
    let daysAvailable = 0;
    for (let i = 0; i < constants_1.PV_HORIZON_DAY_COUNT; i++) {
        const dayIndex = i + 1;
        const raw = rawKwhByDay[i] ?? null;
        let corrected = null;
        let confidence = null;
        if (raw !== null && Number.isFinite(raw) && raw > 0) {
            daysAvailable++;
            totalRaw += raw;
            hasRawSum = true;
            if (biasPct !== null && Number.isFinite(biasPct)) {
                corrected = correctHorizonKwh(raw, biasPct, dayIndex);
                totalCorrected += corrected;
                hasCorrectedSum = true;
            }
            if (baseConfidencePct !== null && Number.isFinite(baseConfidencePct)) {
                confidence = horizonDayConfidencePct(baseConfidencePct, dayIndex);
            }
        }
        days.push({ dayIndex, rawKwh: raw, correctedKwh: corrected, confidencePct: confidence });
    }
    let status = "no_data";
    if (daysAvailable === 0) {
        status = "no_data";
    }
    else if (biasPct === null || !Number.isFinite(biasPct)) {
        status = "no_bias";
    }
    else if (daysAvailable === constants_1.PV_HORIZON_DAY_COUNT) {
        status = "ready";
    }
    else {
        status = "partial";
    }
    return {
        days,
        total7dRawKwh: hasRawSum ? totalRaw : null,
        total7dCorrectedKwh: hasCorrectedSum ? totalCorrected : null,
        daysAvailable,
        status,
    };
}
exports.computePvHorizon = computePvHorizon;
