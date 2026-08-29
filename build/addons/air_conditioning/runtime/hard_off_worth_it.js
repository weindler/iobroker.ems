"use strict";
/**
 * Hard-Off-Restzeit vs. Komfortbedarf — verhindert einen Start kurz vor der Zwangsabschaltung,
 * ohne eine starre „nie unter X Minuten“-Regel: bei starkem Komfortbedarf sinkt die geforderte
 * Mindestlaufzeit gegen 0 (Start bleibt möglich). Reine Zeit-Arithmetik, reuse von
 * `parseClockToMinutes` (time.ts) — keine zweite Uhrzeit-Logik.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isHardOffStartWorthwhile = exports.dehumidifyDemandUrgency01 = exports.coolingDemandUrgency01 = exports.minutesUntilHardOff = exports.AC_URGENCY_REFERENCE_HUMIDITY_PCT_DEFAULT = exports.AC_URGENCY_REFERENCE_TEMP_K_DEFAULT = exports.AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT = void 0;
const time_1 = require("./time");
/** Referenz-Mindestlaufzeit (Minuten) bei neutralem (0) Komfortbedarf. */
exports.AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT = 20;
/** Temperatur-Spanne (K) über der Ein-Schwelle, die volle (1.0) Dringlichkeit ergibt. */
exports.AC_URGENCY_REFERENCE_TEMP_K_DEFAULT = 2;
/** Feuchte-Spanne (%-Punkte) über der Max-Schwelle, die volle (1.0) Dringlichkeit ergibt. */
exports.AC_URGENCY_REFERENCE_HUMIDITY_PCT_DEFAULT = 10;
function clamp01(n) {
    if (!Number.isFinite(n))
        return 0;
    return Math.max(0, Math.min(1, n));
}
/** Minuten bis zur konfigurierten Hard-Off-Uhrzeit; null = kein gültiger Hard-Off konfiguriert. */
function minutesUntilHardOff(nowMin, hardOffRaw) {
    const off = (0, time_1.parseClockToMinutes)(hardOffRaw);
    if (off === null)
        return null;
    const diff = off - nowMin;
    return diff >= 0 ? diff : diff + 24 * 60;
}
exports.minutesUntilHardOff = minutesUntilHardOff;
/** Dringlichkeit aus Temperatur-Überschreitung (0 = an Schwelle, 1 = ≥ Referenz-Spanne drüber). */
function coolingDemandUrgency01(roomTempC, onTempC, referenceK = exports.AC_URGENCY_REFERENCE_TEMP_K_DEFAULT) {
    if (roomTempC === null || !(referenceK > 0))
        return 0;
    return clamp01((roomTempC - onTempC) / referenceK);
}
exports.coolingDemandUrgency01 = coolingDemandUrgency01;
/** Dringlichkeit aus Feuchte-Überschreitung (0 = an Schwelle, 1 = ≥ Referenz-Spanne drüber). */
function dehumidifyDemandUrgency01(roomHumidityPct, maxHumidityPct, referencePct = exports.AC_URGENCY_REFERENCE_HUMIDITY_PCT_DEFAULT) {
    if (roomHumidityPct === null || maxHumidityPct === null || !(referencePct > 0))
        return 0;
    return clamp01((roomHumidityPct - maxHumidityPct) / referencePct);
}
exports.dehumidifyDemandUrgency01 = dehumidifyDemandUrgency01;
/**
 * Kein blindes Starten kurz vor Hard-Off, aber keine starre Schwelle: die geforderte
 * Mindestlaufzeit schrumpft linear mit steigender Dringlichkeit auf 0 (volle Dringlichkeit
 * erlaubt jeden Start, auch unmittelbar vor Hard-Off).
 */
function isHardOffStartWorthwhile(input) {
    if (input.remainingMinutesUntilHardOff === null) {
        return { worthwhile: true, requiredMinutes: 0, reasonDe: "" };
    }
    const urgency = clamp01(input.demandUrgency01);
    const base = input.minWorthwhileRuntimeMin ?? exports.AC_MIN_WORTHWHILE_RUNTIME_MIN_DEFAULT;
    const requiredMinutes = Math.round(base * (1 - urgency));
    const worthwhile = input.remainingMinutesUntilHardOff >= requiredMinutes;
    return {
        worthwhile,
        requiredMinutes,
        reasonDe: worthwhile
            ? ""
            : `Hard-Off in ${input.remainingMinutesUntilHardOff} Min — bei aktuellem Komfortbedarf (${Math.round(urgency * 100)} %) wären mind. ${requiredMinutes} Min nötig, Start zurückgestellt.`,
    };
}
exports.isHardOffStartWorthwhile = isHardOffStartWorthwhile;
