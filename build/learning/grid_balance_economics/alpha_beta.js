"use strict";
/**
 * α/β aus vergleichbaren GB-an/GB-aus-Fenstern.
 * Messwerte werden nicht auf β ≥ α oder [0,1] zurechtgestutzt.
 * Unplausibel / zu streuend → usable=false.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.filterWindowsByLookback = exports.learnAlphaBeta = exports.windowsMatch = void 0;
const constants_1 = require("./constants");
const types_1 = require("./types");
function median(values) {
    if (values.length === 0)
        return null;
    const s = values.slice().sort((a, b) => a - b);
    const mid = Math.floor(s.length / 2);
    return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function iqr(values) {
    if (values.length < 4)
        return null;
    const s = values.slice().sort((a, b) => a - b);
    const q1 = s[Math.floor(s.length * 0.25)];
    const q3 = s[Math.floor(s.length * 0.75)];
    return q3 - q1;
}
function closeEnough(a, b, rel, abs) {
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b))
        return false;
    return Math.abs(a - b) <= Math.max(abs, rel * Math.max(Math.abs(a), Math.abs(b), 1));
}
function hourOf(ts) {
    return new Date(ts).getHours() + new Date(ts).getMinutes() / 60;
}
function windowsMatch(on, off) {
    if (on.durationSec < 1 || off.durationSec < 1)
        return false;
    if (!closeEnough(on.houseMeanW, off.houseMeanW, constants_1.MATCH_HOUSE_REL, constants_1.MATCH_HOUSE_ABS_W))
        return false;
    if (on.pvMeanW != null && off.pvMeanW != null) {
        if (!closeEnough(on.pvMeanW, off.pvMeanW, constants_1.MATCH_PV_REL, constants_1.MATCH_PV_ABS_W))
            return false;
    }
    if (on.deficitMeanW != null && off.deficitMeanW != null) {
        if (!closeEnough(on.deficitMeanW, off.deficitMeanW, constants_1.MATCH_DEFICIT_REL, constants_1.MATCH_DEFICIT_ABS_W))
            return false;
    }
    if (on.socMeanPct != null && off.socMeanPct != null) {
        if (Math.abs(on.socMeanPct - off.socMeanPct) > constants_1.MATCH_SOC_ABS_PCT)
            return false;
    }
    if (Math.abs(hourOf(on.startTs) - hourOf(off.startTs)) > constants_1.MATCH_HOUR_ABS)
        return false;
    return true;
}
exports.windowsMatch = windowsMatch;
function pairFromMatch(on, off) {
    if (!(on.eGbKwh >= constants_1.MIN_GB_ENERGY_KWH))
        return null;
    if (on.importKwh == null || off.importKwh == null)
        return null;
    if (on.batteryDischargeKwh == null || off.batteryDischargeKwh == null)
        return null;
    const scale = on.durationSec / off.durationSec;
    if (!(scale > 0) || !Number.isFinite(scale))
        return null;
    const importOff = off.importKwh * scale;
    const battOff = off.batteryDischargeKwh * scale;
    const alpha = (importOff - on.importKwh) / on.eGbKwh;
    const beta = (on.batteryDischargeKwh - battOff) / on.eGbKwh;
    if (!Number.isFinite(alpha) || !Number.isFinite(beta))
        return null;
    return { alpha, beta, eGbKwh: on.eGbKwh, source: on.source };
}
function learnAlphaBeta(windows) {
    const ons = windows.filter((w) => w.gbOn && w.eGbKwh >= constants_1.MIN_GB_ENERGY_KWH);
    const offs = windows.filter((w) => !w.gbOn && w.durationSec >= 60);
    if (ons.length === 0 || offs.length === 0) {
        return (0, types_1.emptyAlphaBeta)(ons.length === 0
            ? "Keine lernfähigen GB-an-Fenster — Economics nicht usable (30-ct-Fallback)."
            : "Keine vergleichbaren GB-aus-Fenster — Economics nicht usable (30-ct-Fallback).");
    }
    const pairs = [];
    for (const on of ons) {
        let best = null;
        let bestScore = Number.POSITIVE_INFINITY;
        for (const off of offs) {
            if (!windowsMatch(on, off))
                continue;
            const p = pairFromMatch(on, off);
            if (!p)
                continue;
            const houseGap = on.houseMeanW != null && off.houseMeanW != null ? Math.abs(on.houseMeanW - off.houseMeanW) : 999;
            if (houseGap < bestScore) {
                bestScore = houseGap;
                best = p;
            }
        }
        if (best)
            pairs.push(best);
    }
    if (pairs.length === 0) {
        return (0, types_1.emptyAlphaBeta)("Keine ausreichend vergleichbaren GB-an/aus-Paare — Economics nicht usable.");
    }
    const alphas = pairs.map((p) => p.alpha);
    const betas = pairs.map((p) => p.beta);
    const alphaMed = median(alphas);
    const betaMed = median(betas);
    const alphaSpread = iqr(alphas);
    const betaSpread = iqr(betas);
    const episodePairs = pairs.filter((p) => p.source === "episode").length;
    const slotPairs = pairs.filter((p) => p.source === "slot").length;
    const minPairs = episodePairs >= constants_1.MIN_PAIRS_FOR_USABLE ? constants_1.MIN_PAIRS_FOR_USABLE : constants_1.MIN_PAIRS_SLOT_FALLBACK;
    if (pairs.length < minPairs) {
        return {
            usable: false,
            alpha: alphaMed,
            beta: betaMed,
            confidence: Math.min(0.4, pairs.length / minPairs),
            pairCount: pairs.length,
            episodePairCount: episodePairs,
            slotPairCount: slotPairs,
            alphaIqr: alphaSpread,
            betaIqr: betaSpread,
            reasonDe: `Zu wenige Vergleichspaare (${pairs.length}/${minPairs}) — Economics nicht usable.`,
        };
    }
    if (alphaMed == null ||
        betaMed == null ||
        alphaMed < constants_1.ALPHA_PLAUSIBLE_MIN ||
        alphaMed > constants_1.ALPHA_PLAUSIBLE_MAX ||
        betaMed < constants_1.BETA_PLAUSIBLE_MIN ||
        betaMed > constants_1.BETA_PLAUSIBLE_MAX) {
        return {
            usable: false,
            alpha: alphaMed,
            beta: betaMed,
            confidence: 0.2,
            pairCount: pairs.length,
            episodePairCount: episodePairs,
            slotPairCount: slotPairs,
            alphaIqr: alphaSpread,
            betaIqr: betaSpread,
            reasonDe: "Median α/β außerhalb des plausiblen Bereichs — nicht usable (Werte nicht zurechtgestutzt).",
        };
    }
    const relIqrA = alphaSpread != null ? alphaSpread / Math.max(Math.abs(alphaMed), 0.05) : null;
    const relIqrB = betaSpread != null ? betaSpread / Math.max(Math.abs(betaMed), 0.05) : null;
    if ((relIqrA != null && relIqrA > constants_1.MAX_RELATIVE_IQR) || (relIqrB != null && relIqrB > constants_1.MAX_RELATIVE_IQR)) {
        return {
            usable: false,
            alpha: alphaMed,
            beta: betaMed,
            confidence: 0.3,
            pairCount: pairs.length,
            episodePairCount: episodePairs,
            slotPairCount: slotPairs,
            alphaIqr: alphaSpread,
            betaIqr: betaSpread,
            reasonDe: "Streuung von α/β zu groß — Economics nicht usable.",
        };
    }
    const nScore = Math.min(1, pairs.length / (minPairs * 2));
    const spreadScore = relIqrA == null || relIqrB == null ? 0.6 : Math.max(0, 1 - Math.max(relIqrA, relIqrB) / constants_1.MAX_RELATIVE_IQR);
    const episodeBoost = episodePairs >= constants_1.MIN_PAIRS_FOR_USABLE ? 1 : 0.75;
    const confidence = Math.round(nScore * spreadScore * episodeBoost * 1000) / 1000;
    return {
        usable: confidence >= 0.35,
        alpha: alphaMed,
        beta: betaMed,
        confidence,
        pairCount: pairs.length,
        episodePairCount: episodePairs,
        slotPairCount: slotPairs,
        alphaIqr: alphaSpread,
        betaIqr: betaSpread,
        reasonDe: confidence >= 0.35
            ? `α/β aus ${pairs.length} Vergleichspaaren (Episoden ${episodePairs}, Slots ${slotPairs}).`
            : "Confidence zu niedrig — Economics nicht usable.",
    };
}
exports.learnAlphaBeta = learnAlphaBeta;
function filterWindowsByLookback(windows, nowMs, lookbackDays = constants_1.LOOKBACK_DAYS) {
    const cutoff = nowMs - lookbackDays * 86_400_000;
    return windows.filter((w) => w.startTs >= cutoff);
}
exports.filterWindowsByLookback = filterWindowsByLookback;
