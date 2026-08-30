"use strict";
/**
 * Reserve-Umrechnung (Verbrauch-kWh → SOC-%) — ersetzte ursprünglich die feste 50-%-Schwelle.
 *
 * Diese Datei liefert nur die Prozent-/kWh-Umrechnung (Margin auf Verbrauch, geteilt durch
 * Kapazität). Sie ist NICHT mehr die alleinige Autorität für die Netzausgleich-Entladeentscheidung
 * — das ist jetzt `operator/daily_plan/battery_reserve_target.ts` (die EINE zentrale, dynamische
 * Batterie-Reserve), die diese Funktion mit dem BEREITS ZUSAMMENGEFÜHRTEN Verbrauchswert
 * (Forecast + reale Historie) aufruft, statt mit `predictedNightConsumptionKwh` allein.
 *
 * `learning.battery_runtime.required_soc_at_pv_end_pct` (dieses Modul, nur aus Historie) bleibt
 * als Diagnose/Referenz veröffentlicht, wird aber vom Planner nicht mehr direkt als
 * Entladeschwelle gelesen — kein zweiter, unabhängig konkurrierender SOC-Zielwert mehr.
 *
 * Kein fester Fallback-Prozentwert: fehlt der Verbrauchswert oder die nutzbare Kapazität, ist
 * die Reserve schlicht nicht berechenbar (null) — der Aufrufer entscheidet dann konservativ
 * (kein Wirtschafts-Entladebudget), statt einen versteckten 50-%-Wert zu verwenden. Absolute
 * Hardware-/Safety-SOC-Grenzen bleiben davon unberührt und unverändert an anderer Stelle
 * (Battery-Runtime) bestehen.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveRequiredSocAtPvEndPct = exports.NIGHT_RESERVE_SAFETY_MARGIN_FRACTION = void 0;
/** Aufschlag auf den gelernten Ø-Nachtverbrauch — Streuung zwischen Nächten abfedern. */
exports.NIGHT_RESERVE_SAFETY_MARGIN_FRACTION = 0.2;
function round1(n) {
    return Math.round(n * 10) / 10;
}
function resolveRequiredSocAtPvEndPct(input) {
    const margin = input.safetyMarginFraction ?? exports.NIGHT_RESERVE_SAFETY_MARGIN_FRACTION;
    if (input.predictedNightConsumptionKwh === null || !(input.predictedNightConsumptionKwh >= 0)) {
        return {
            requiredSocAtPvEndPct: null,
            requiredReserveKwh: null,
            reasonDe: "Gelernter Nachtverbrauch noch unbekannt — Reserve nicht dynamisch berechenbar.",
        };
    }
    if (input.usableCapacityKwh === null || !(input.usableCapacityKwh > 0)) {
        return {
            requiredSocAtPvEndPct: null,
            requiredReserveKwh: null,
            reasonDe: "Nutzbare Batteriekapazität unbekannt — Reserve nicht dynamisch berechenbar.",
        };
    }
    const rawReserveKwh = Math.round(input.predictedNightConsumptionKwh * (1 + margin) * 1000) / 1000;
    /** Physikalisch: Reserve kann die nutzbare Kapazität nicht überschreiten. */
    const requiredReserveKwh = Math.min(rawReserveKwh, input.usableCapacityKwh);
    const pct = (requiredReserveKwh / input.usableCapacityKwh) * 100;
    const requiredSocAtPvEndPct = round1(Math.min(100, Math.max(0, pct)));
    const capped = requiredReserveKwh < rawReserveKwh - 0.0005;
    return {
        requiredSocAtPvEndPct,
        requiredReserveKwh,
        reasonDe: capped
            ? `Reserve ${requiredReserveKwh.toFixed(1)} kWh (${requiredSocAtPvEndPct.toFixed(0)} %) — gelernt ${input.predictedNightConsumptionKwh.toFixed(1)} kWh + ${Math.round(margin * 100)} % Aufschlag würde ${rawReserveKwh.toFixed(1)} kWh ergeben, auf nutzbare Kapazität ${input.usableCapacityKwh.toFixed(1)} kWh begrenzt.`
            : `Reserve ${requiredReserveKwh.toFixed(1)} kWh (${requiredSocAtPvEndPct.toFixed(0)} %) aus gelerntem Nachtverbrauch ${input.predictedNightConsumptionKwh.toFixed(1)} kWh + ${Math.round(margin * 100)} % Sicherheitsaufschlag.`,
    };
}
exports.resolveRequiredSocAtPvEndPct = resolveRequiredSocAtPvEndPct;
