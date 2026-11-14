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
exports.INTRADAY_RECENT_WEIGHT = exports.INTRADAY_RECENT_MIN_EXPECTED_KWH = exports.INTRADAY_RECENT_WINDOW_MS = exports.INTRADAY_DEAD_BAND = exports.INTRADAY_MAX_FACTOR = exports.INTRADAY_MIN_FACTOR = exports.INTRADAY_FULL_WEIGHT_KWH = exports.INTRADAY_MIN_EXPECTED_KWH = void 0;
exports.recentActualFromHistory = recentActualFromHistory;
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
/** Toleranz: Abweichungen darunter lösen keine Korrektur aus. */
exports.INTRADAY_DEAD_BAND = 0.08;
/** Letzte Stunde als zweites Signal: Fenster und Mindest-Erwartung darin. */
exports.INTRADAY_RECENT_WINDOW_MS = 3_600_000;
exports.INTRADAY_RECENT_MIN_EXPECTED_KWH = 0.4;
/** Gewicht des Verhältnisses der letzten Stunde gegenüber der Tagessumme. */
exports.INTRADAY_RECENT_WEIGHT = 0.5;
/**
 * Ertrag in (ungefähr) der letzten Stunde aus gemerkten Zählerständen. Verwendet den Stand, der am
 * nächsten bei `now − 60 min` liegt (45–75 min zurück); sonst null (z. B. nach Neustart).
 */
function recentActualFromHistory(history, nowMs, kwhNow) {
    let best = null;
    for (const s of history) {
        const age = nowMs - s.ts;
        if (age < 45 * 60_000 || age > 75 * 60_000)
            continue;
        if (!best || Math.abs(age - exports.INTRADAY_RECENT_WINDOW_MS) < Math.abs(nowMs - best.ts - exports.INTRADAY_RECENT_WINDOW_MS))
            best = s;
    }
    if (!best || kwhNow < best.kwh)
        return null;
    return { deltaKwh: kwhNow - best.kwh, windowMs: nowMs - best.ts };
}
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
function computeIntradayFactor(todaySlots, actualTodayKwh, nowMs, recent = null) {
    if (actualTodayKwh === null || !Number.isFinite(actualTodayKwh) || actualTodayKwh < 0) {
        return NO_CORRECTION("Kein gültiger Ist-Ertrag für heute.");
    }
    const expected = expectedEnergySoFarKwh(todaySlots, nowMs);
    if (expected < exports.INTRADAY_MIN_EXPECTED_KWH) {
        return NO_CORRECTION("Noch zu wenig erwartete PV-Energie für eine Korrektur.", expected, actualTodayKwh);
    }
    let ratio = actualTodayKwh / expected;
    let recentNote = "";
    if (recent && recent.windowMs > 0) {
        const expectedRecent = expected - expectedEnergySoFarKwh(todaySlots, nowMs - recent.windowMs);
        if (expectedRecent >= exports.INTRADAY_RECENT_MIN_EXPECTED_KWH) {
            const recentRatio = recent.deltaKwh / expectedRecent;
            ratio = (1 - exports.INTRADAY_RECENT_WEIGHT) * ratio + exports.INTRADAY_RECENT_WEIGHT * recentRatio;
            recentNote = ` Letzte Stunde ${recent.deltaKwh.toFixed(2)} kWh gegen erwartet ${expectedRecent.toFixed(2)} kWh.`;
        }
    }
    const weight = Math.min(1, expected / exports.INTRADAY_FULL_WEIGHT_KWH);
    const raw = 1 + weight * (ratio - 1);
    const factor = Math.max(exports.INTRADAY_MIN_FACTOR, Math.min(exports.INTRADAY_MAX_FACTOR, raw));
    const rounded = Math.round(factor * 1000) / 1000;
    const active = Math.abs(rounded - 1) >= exports.INTRADAY_DEAD_BAND;
    return {
        factor: active ? rounded : 1,
        expectedSoFarKwh: Math.round(expected * 1000) / 1000,
        actualSoFarKwh: actualTodayKwh,
        weight: Math.round(weight * 1000) / 1000,
        active,
        reasonDe: active
            ? `Ist ${actualTodayKwh.toFixed(2)} kWh gegen erwartet ${expected.toFixed(2)} kWh.${recentNote} → Rest des Tages × ${rounded}.`
            : "Ist-Ertrag liegt im Rahmen der Prognose.",
    };
}
/** Skaliert nur Slots, die noch nicht vorbei sind. */
function applyIntradayFactor(slots, factor, nowMs) {
    if (factor === 1)
        return slots;
    return slots.map((s) => (Date.parse(s.endIso) > nowMs ? { ...s, pvPowerW: s.pvPowerW * factor } : s));
}
