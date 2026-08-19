"use strict";
/**
 * Thermische PV-Vorladung — Puffer als flexibler Energiespeicher (Befund 004).
 *
 * Nicht nur „bis emptyAt gerade genug“, sondern:
 * Ist es sinnvoll, jetzt PV thermisch zu speichern, um später elektrische
 * Flexibilität (Auto/Klima/Batterie/Haus) zu gewinnen?
 *
 * estimatedEmptyAt = Info über thermische Reichweite, kein Zielpunkt.
 * Nie über planningMax / unter planningMin. Kein pauschales Max bei PV.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveThermalPvPrecharge = void 0;
const types_1 = require("./types");
function clamp(min, max, v) {
    return Math.min(max, Math.max(min, v));
}
function modeAggressiveness(mode) {
    if (mode === "eco")
        return 0.55;
    if (mode === "comfort" || mode === "forced")
        return 1.0;
    if (mode === "off")
        return 0;
    return 0.85;
}
/**
 * Hebt thermisches Ziel bei sinnvoller PV→Wärme-Speicherung an (keine Writes).
 */
function resolveThermalPvPrecharge(input) {
    const base = input.baseTargetTempC;
    const max = input.planningMaxTempC;
    const min = input.planningMinTempC;
    const agg = modeAggressiveness(input.globalMode);
    if (!(agg > 0) || !(max > base + 0.15)) {
        return {
            active: false,
            targetTempC: base,
            prechargeExtraK: 0,
            reasonDe: "Keine thermische PV-Vorladung (Modus/Ziel).",
        };
    }
    const nowMs = input.now.getTime();
    const emptyMs = input.estimatedEmptyAtIso ? Date.parse(input.estimatedEmptyAtIso) : NaN;
    const nextPvMs = input.nextPvHeatOpportunityIso
        ? Date.parse(input.nextPvHeatOpportunityIso)
        : NaN;
    const vehicleUrgent = input.vehicleUrgentEnergyKwh != null && input.vehicleUrgentEnergyKwh > 0.5;
    if (vehicleUrgent) {
        return {
            active: false,
            targetTempC: base,
            prechargeExtraK: 0,
            reasonDe: "Fahrzeugziel aktiv — thermische Extra-Vorladung zurückgestellt (PV für elektrische Flexibilität).",
        };
    }
    const today = input.pvTodayKwh;
    const tomorrow = input.pvTomorrowKwh;
    const surplus = input.todayPvSurplusKwh;
    const strongToday = (surplus != null && surplus >= 3) ||
        (today != null && today >= 8 && (tomorrow == null || tomorrow >= 0));
    if (!strongToday) {
        return {
            active: false,
            targetTempC: base,
            prechargeExtraK: 0,
            reasonDe: "Zu wenig PV-/Überschuss heute für zusätzliche Wärmespeicherung.",
        };
    }
    const batSoc = input.batterySocPct;
    const batTarget = input.batteryEndSocTargetPct;
    const batterySated = batSoc != null &&
        (batSoc >= 95 ||
            (batTarget != null && batSoc + 0.5 >= batTarget) ||
            batSoc >= 85);
    const batteryCompetes = batSoc != null && batTarget != null && batSoc + 5 < batTarget;
    /*
     * Boiler hält bis zur nächsten belastbaren PV-Gelegenheit über planningMin:
     * kein Target-/Max-Precharge — nur noch wirtschaftlich wenn Batterie satt + starker Surplus.
     */
    const rateEarly = input.coolingRateCPerHAvg;
    if (Number.isFinite(nextPvMs) &&
        nextPvMs > nowMs &&
        rateEarly != null &&
        rateEarly > 0 &&
        input.bufferTempC >= input.planningMinTempC) {
        const hoursToPv = (nextPvMs - nowMs) / 3600_000;
        const tempAtPv = input.bufferTempC - rateEarly * hoursToPv;
        if (tempAtPv >= input.planningMinTempC - 0.05) {
            const emptyAfterPv = !Number.isFinite(emptyMs) || emptyMs >= nextPvMs - 60_000;
            if (emptyAfterPv && !(batterySated && surplus != null && surplus >= 8)) {
                return {
                    active: false,
                    targetTempC: base,
                    prechargeExtraK: 0,
                    reasonDe: "Boiler reicht bis nächster belastbarer PV — kein wirtschaftliches Target-Precharge.",
                };
            }
        }
    }
    /*
     * Horizont: emptyAt (Reichweite) und/oder nächstes PV-Fenster.
     * Fehlt emptyAt, reicht starkes PV + Batterie-satt für Flex-Vorladung.
     */
    const hasEmptyAt = Number.isFinite(emptyMs) && emptyMs > nowMs;
    if (!hasEmptyAt && !batterySated && (surplus == null || surplus < 6)) {
        return {
            active: false,
            targetTempC: base,
            prechargeExtraK: 0,
            reasonDe: "Keine Reichweiten-Info und Batterie nicht satt — Basisziel reicht.",
        };
    }
    const horizonMs = Number.isFinite(nextPvMs) && nextPvMs > nowMs
        ? nextPvMs
        : hasEmptyAt
            ? Math.max(emptyMs, nowMs + 14 * 3600_000)
            : nowMs + 16 * 3600_000;
    let fractionTowardMax = 0.3 * agg;
    // Batterie satt → thermisch speichern schafft spätere elektrische Flexibilität
    if (batterySated)
        fractionTowardMax += 0.4;
    if (batteryCompetes)
        fractionTowardMax *= 0.4;
    if (surplus != null && surplus >= 8)
        fractionTowardMax += 0.18;
    else if (surplus != null && surplus >= 5)
        fractionTowardMax += 0.08;
    if (tomorrow != null && today != null && tomorrow < today * 0.55) {
        fractionTowardMax += 0.15;
    }
    // emptyAt heute/bald = Reichweite kurz → mehr Vorladung sinnvoll
    if (hasEmptyAt) {
        const hoursToEmpty = (emptyMs - nowMs) / 3600_000;
        if (hoursToEmpty < 8)
            fractionTowardMax += 0.12;
        else if (hoursToEmpty < 14)
            fractionTowardMax += 0.06;
    }
    const futureFlex = input.futureElectricalFlexHintKwh;
    if (futureFlex != null && futureFlex >= 2) {
        fractionTowardMax += Math.min(0.2, futureFlex / 25);
    }
    // Niedrige Exportvergütung / hoher Import → Speicher lohnt sich
    if (input.exportTariffCtPerKwh != null && input.exportTariffCtPerKwh < 5) {
        fractionTowardMax += 0.1;
    }
    else if (input.exportTariffCtPerKwh != null && input.exportTariffCtPerKwh < 9) {
        fractionTowardMax += 0.04;
    }
    if (input.importTariffCtPerKwh != null && input.importTariffCtPerKwh >= 28) {
        fractionTowardMax += 0.08;
    }
    if (input.globalMode === "eco" && !batterySated) {
        fractionTowardMax *= 0.65;
    }
    if (input.globalMode === "comfort" || input.globalMode === "forced") {
        fractionTowardMax += 0.08;
    }
    fractionTowardMax = clamp(0, 1, fractionTowardMax);
    const span = max - base;
    let extra = (0, types_1.round3)(span * fractionTowardMax);
    // Physikalische Untergrenze aus Kühlrate bis nächster PV-Gelegenheit
    const rate = input.coolingRateCPerHAvg;
    if (rate != null && rate > 0) {
        const hoursToPv = Math.max(0, (horizonMs - nowMs) / 3600_000);
        const physicsFloor = (0, types_1.round3)(min + rate * (hoursToPv + 1));
        const needAboveBase = Math.max(0, physicsFloor - base);
        extra = Math.max(extra, Math.min(span, needAboveBase));
    }
    const target = (0, types_1.round3)(clamp(min, max, base + extra));
    if (target <= base + 0.2) {
        return {
            active: false,
            targetTempC: base,
            prechargeExtraK: 0,
            reasonDe: "PV-Vorladung rechnerisch vernachlässigbar.",
        };
    }
    const parts = [
        `Thermische Flex-Vorladung +${(target - base).toFixed(1)} K → ${target} °C`,
        batterySated ? "Batterie satt" : "Batterie mit Restbedarf",
        hasEmptyAt ? "emptyAt als Reichweite" : "ohne emptyAt",
        futureFlex != null && futureFlex >= 2 ? `späterer Flexbedarf ~${futureFlex.toFixed(1)} kWh` : null,
        input.globalMode,
    ].filter(Boolean);
    return {
        active: true,
        targetTempC: target,
        prechargeExtraK: (0, types_1.round3)(target - base),
        reasonDe: parts.join("; ") + ".",
    };
}
exports.resolveThermalPvPrecharge = resolveThermalPvPrecharge;
