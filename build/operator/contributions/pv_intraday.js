"use strict";
/**
 * Korrektur der PV-Prognose im Tagesverlauf.
 *
 * Der gelernte Bias gilt für ganze Tage. Liegt der Ist-Ertrag am Vormittag klar neben der
 * Prognose für denselben Zeitraum, wird der Rest des Tages mit einem Faktor skaliert. Grundlage
 * ist die Summe seit Tagesbeginn (nicht die Momentanleistung) — eine Wolke um 11 Uhr kippt den
 * Tag nicht. Reine Funktion, keine I/O.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTRADAY_MAX_FACTOR = exports.INTRADAY_MIN_FACTOR = exports.INTRADAY_FULL_WEIGHT_KWH = exports.INTRADAY_MIN_EXPECTED_KWH = void 0;
exports.expectedEnergySoFarKwh = expectedEnergySoFarKwh;
exports.computeIntradayFactor = computeIntradayFactor;
exports.applyIntradayFactor = applyIntradayFactor;
/** Unter dieser erwarteten Energie seit Tagesbeginn wird nicht korrigiert (zu wenig Evidenz). */
exports.INTRADAY_MIN_EXPECTED_KWH = 0.8;
/** Ab dieser erwarteten Energie wirkt die Korrektur mit vollem Gewicht. */
exports.INTRADAY_FULL_WEIGHT_KWH = 2.5;
/** Begrenzung des Faktors: nach unten stark, nach oben vorsichtig. */
exports.INTRADAY_MIN_FACTOR = 0.25;
exports.INTRADAY_MAX_FACTOR = 1.25;
const NO_CORRECTION = (reasonDe, expected = 0, actual = null) => ({
    factor: 1,
    expectedSoFarKwh: expected,
    actualSoFarKwh: actual,
    weight: 0,
    active: false,
    reasonDe,
});
/** Erwartete PV-Energie (kWh) vom ersten Slot bis `nowMs`; angebrochene Slots anteilig. */
function expectedEnergySoFarKwh(slots, nowMs) {
    let kwh = 0;
    for (const s of slots) {
        const start = Date.parse(s.startIso);
        const end = Date.parse(s.endIso);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || start >= nowMs)
            continue;
        const elapsedMs = Math.min(end, nowMs) - start;
        kwh += (s.pvPowerW / 1000) * (elapsedMs / 3_600_000);
    }
    return kwh;
}
function computeIntradayFactor(todaySlots, actualTodayKwh, nowMs) {
    if (actualTodayKwh === null || !Number.isFinite(actualTodayKwh) || actualTodayKwh < 0) {
        return NO_CORRECTION("Kein gültiger Ist-Ertrag für heute.");
    }
    const expected = expectedEnergySoFarKwh(todaySlots, nowMs);
    if (expected < exports.INTRADAY_MIN_EXPECTED_KWH) {
        return NO_CORRECTION("Noch zu wenig erwartete PV-Energie für eine Korrektur.", expected, actualTodayKwh);
    }
    const ratio = actualTodayKwh / expected;
    const weight = Math.min(1, expected / exports.INTRADAY_FULL_WEIGHT_KWH);
    const raw = 1 + weight * (ratio - 1);
    const factor = Math.max(exports.INTRADAY_MIN_FACTOR, Math.min(exports.INTRADAY_MAX_FACTOR, raw));
    const rounded = Math.round(factor * 1000) / 1000;
    const active = Math.abs(rounded - 1) >= 0.03;
    return {
        factor: active ? rounded : 1,
        expectedSoFarKwh: Math.round(expected * 1000) / 1000,
        actualSoFarKwh: actualTodayKwh,
        weight: Math.round(weight * 1000) / 1000,
        active,
        reasonDe: active
            ? `Ist ${actualTodayKwh.toFixed(2)} kWh gegen erwartet ${expected.toFixed(2)} kWh → Rest des Tages × ${rounded}.`
            : "Ist-Ertrag liegt im Rahmen der Prognose.",
    };
}
/** Skaliert nur Slots, die noch nicht vorbei sind. */
function applyIntradayFactor(slots, factor, nowMs) {
    if (factor === 1)
        return slots;
    return slots.map((s) => (Date.parse(s.endIso) > nowMs ? { ...s, pvPowerW: s.pvPowerW * factor } : s));
}
