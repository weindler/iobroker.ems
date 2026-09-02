"use strict";
/**
 * C_replace — wirtschaftlicher Wert einer jetzt zusätzlich entnommenen Batterie-kWh.
 * Ein dominanter Pfad, keine Mischwahrscheinlichkeiten.
 * Opportunity-PV×0.3 wird hier nicht verwendet.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateBatteryReplaceCost = void 0;
const constants_1 = require("../../learning/grid_balance_economics/constants");
function finite(n) {
    return n != null && Number.isFinite(n);
}
function laterPrices(input) {
    return input.priceSlots
        .filter((s) => s.startMs > input.nowMs && finite(s.importCtPerKwh))
        .map((s) => s.importCtPerKwh);
}
function cheapestLater(prices) {
    if (prices.length === 0)
        return null;
    return Math.min(...prices);
}
function peakLater(prices) {
    if (prices.length === 0)
        return null;
    return Math.max(...prices);
}
function result(value, path, reasonDe, confidence, usable) {
    return { valueCtPerKwh: value, path, reasonDe, confidence, usable };
}
function evaluateBatteryReplaceCost(input) {
    const etaPv = input.etaPvPath > 0.05 && input.etaPvPath <= 1.05 ? input.etaPvPath : constants_1.ETA_PATH_FALLBACK;
    const etaGrid = input.etaGridPath > 0.05 && input.etaGridPath <= 1.05 ? input.etaGridPath : constants_1.ETA_PATH_FALLBACK;
    const pvLeft = Math.max(0, input.pvRemainingTodayKwh ?? 0);
    const headroom = finite(input.headroomAboveReserveKwh) ? Math.max(0, input.headroomAboveReserveKwh) : null;
    const laterDemand = Math.max(0, input.plannedLaterDemandKwh ?? 0);
    const predictedUntilPv = finite(input.predictedConsumptionUntilNextPvKwh)
        ? Math.max(0, input.predictedConsumptionUntilNextPvKwh)
        : null;
    const prices = laterPrices(input);
    const cheap = cheapestLater(prices);
    const peak = peakLater(prices);
    const feedIn = finite(input.feedInCtPerKwh) && input.feedInCtPerKwh >= 0 ? input.feedInCtPerKwh : null;
    const remainingChargeRoomKwh = finite(input.usableCapacityKwh) && finite(input.socPct) && finite(input.maxSocPct)
        ? Math.max(0, ((input.maxSocPct - input.socPct) / 100) * input.usableCapacityKwh)
        : null;
    /* D) Deutlicher Surplus / Batterie wird ohnehin voll → Einspeisepfad, nicht späterer Peak. */
    if (remainingChargeRoomKwh != null &&
        pvLeft > remainingChargeRoomKwh + 1 &&
        feedIn != null) {
        return result(feedIn / etaPv, "surplus_export", `C_replace: PV-Überschuss füllt die Batterie voraussichtlich — Wert ≈ Einspeisung/η_pv (${feedIn.toFixed(1)}/${etaPv.toFixed(2)}).`, 0.75, true);
    }
    /* C) Extra-kWh wird später gebraucht, um teuren Bezug zu vermeiden. */
    const needLater = (predictedUntilPv != null && headroom != null && predictedUntilPv > headroom + 0.15) ||
        (laterDemand > 0.15 && headroom != null && laterDemand - pvLeft > headroom + 0.15);
    if (needLater && peak != null && !(pvLeft > (predictedUntilPv ?? laterDemand) + 0.5)) {
        return result(peak, "later_avoided_import", `C_replace: Batterieenergie später für teureren Bezug nötig — Wert ${peak.toFixed(1)} ct/kWh.`, 0.7, true);
    }
    /* B) Erwartetes / erlaubtes günstiges Netzladen. */
    if (input.gridChargeAllowed && cheap != null && (peak == null || cheap + 4 < peak)) {
        return result(cheap / etaGrid, "grid_charge", `C_replace: Wiederbeschaffung über Netzladefenster ${cheap.toFixed(1)} ct/kWh / η_grid ${etaGrid.toFixed(2)}.`, 0.65, true);
    }
    /* A) Sichere PV-Wiederauffüllung. */
    if (pvLeft > 1 && feedIn != null && (headroom == null || pvLeft >= 0.5)) {
        return result(feedIn / etaPv, "pv_refill", `C_replace: PV-Wiederauffüllung erwartet — Wert ≈ Einspeisung/η_pv (${feedIn.toFixed(1)}/${etaPv.toFixed(2)}).`, 0.6, true);
    }
    return result(null, null, "C_replace: kein dominanter belastbarer Energiepfad — Economics nicht usable.", 0, false);
}
exports.evaluateBatteryReplaceCost = evaluateBatteryReplaceCost;
