"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.todayPvSurplusKwh = exports.pvSurplusCoversChargeNeed = void 0;
/**
 * Wenn der erwartete Tages-PV-Überschuss (PV − Hauslast) den Batterie-Ladebedarf deckt,
 * braucht das EMS keine aktiven Lade-Slots — die Batterie füllt sich über Eigenverbrauch/PV.
 * Top-Off (Nutzer oder gelernt) und fehlende Surplus-Daten bleiben ausgenommen.
 */
function pvSurplusCoversChargeNeed(input) {
    if (input.topOffRequested || input.learnedTopoffDue)
        return false;
    const need = input.requiredChargeEnergyKwh;
    const surplus = input.todayPvSurplusKwh;
    if (need === null || need <= 0)
        return false;
    if (surplus === null || !Number.isFinite(surplus))
        return false;
    return surplus >= need;
}
exports.pvSurplusCoversChargeNeed = pvSurplusCoversChargeNeed;
function todayPvSurplusKwh(pvTodayKwh, houseLoadTodayKwh) {
    if (pvTodayKwh === null || houseLoadTodayKwh === null)
        return null;
    if (!Number.isFinite(pvTodayKwh) || !Number.isFinite(houseLoadTodayKwh))
        return null;
    return Math.max(0, Math.round((pvTodayKwh - houseLoadTodayKwh) * 1000) / 1000);
}
exports.todayPvSurplusKwh = todayPvSurplusKwh;
