"use strict";
/**
 * Zentrale dynamische Batterie-Reserve (Block: "eine maßgebliche Reserve für den Unified Planner").
 *
 * Führt bestehende Wege ZUSAMMEN, statt eine dritte Reserve-Logik einzuführen:
 * - `learning/battery_runtime` liefert die reale, historisch gelernte Verbrauchsbasis
 *   (`predictedNightConsumptionKwh`, `avgChargePowerW`) — unverändert, bleibt „Ist“-Quelle.
 * - `operator/daily_plan/unified/next_reliable_pv.ts` (unverändert) liefert Zeitpunkt/Netto-
 *   Bedarf bis zum nächsten verlässlichen PV-Fenster aus dem PV-/Hauslast-Forecast.
 * - `battery.charge`-Contribution (`operator/contributions/flexible/battery.ts`, unverändert)
 *   liefert bereits ein kombiniertes Lade-/Reserveziel (`planDynamicBatteryEndSoc` +
 *   `planBatteryChargeLogic`, deckt auch mehrtägiges PV-Defizit ab).
 * - `learning/battery_runtime/reserve.ts` liefert die Margin-/Prozent-Umrechnung (unverändert),
 *   hier auf den kombinierten Nettobedarf statt nur auf die reine Nachthistorie angewendet.
 *
 * Ergebnis: EIN `requiredSocAtPvEndPct` (Maximum aus forecast+learning-basierter Reserve und dem
 * bereits vorhandenen Contribution-Ziel) — für Lade- UND Entladeplanung nutzbar. Kein Admin-/
 * Hardware-Grenzwert wird hier verändert; Safety/Ownership bleiben unverändert lokal in der
 * Battery-Runtime und wirken zusätzlich, nachgeschaltet.
 *
 * Fehlen Daten (kein Forecast, keine Learning-Historie) → konservativ `null`
 * (kein wirtschaftliches Ziel ableitbar), niemals ein versteckter fester Prozentwert.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveCentralBatteryReserveTarget = void 0;
const next_reliable_pv_1 = require("./unified/next_reliable_pv");
const forecast_reserve_slots_1 = require("./forecast_reserve_slots");
const reserve_1 = require("../../learning/battery_runtime/reserve");
function round1(n) {
    return Math.round(n * 10) / 10;
}
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function resolveCentralBatteryReserveTarget(input) {
    const hasSlots = input.slots.length > 0;
    const fromIdx = hasSlots ? (0, forecast_reserve_slots_1.findCurrentSlotIdx)(input.slots, input.nowMs) : 0;
    const conf = input.pvConfidence01 ?? 0.7;
    let nextReliable = {
        slotIdx: null,
        startIso: null,
        startMs: null,
        reasonDe: "Kein PV-/Hauslast-Forecast verfügbar.",
    };
    let forecastNetDemandKwh = null;
    if (hasSlots) {
        nextReliable = (0, next_reliable_pv_1.findNextReliablePvAfterCurrentWindow)(input.slots, fromIdx, conf, input.nowMs);
        forecastNetDemandKwh = round3((0, next_reliable_pv_1.expectedNetDemandUntilPvKwh)(input.slots, fromIdx, nextReliable.slotIdx, conf));
    }
    const learningKwh = input.predictedNightConsumptionKwh;
    const forecastKnown = hasSlots && nextReliable.slotIdx !== null;
    const learningKnown = learningKwh !== null && Number.isFinite(learningKwh) && learningKwh >= 0;
    /*
     * Reale Historie ist ein Sicherheitsboden für den Forecast — nie umgekehrt: ein optimistischer
     * Forecast darf die tatsächlich beobachtete Verbrauchshöhe nicht unterschreiten.
     */
    let predictedConsumptionUntilNextPvKwh = null;
    const parts = [];
    if (forecastKnown && learningKnown) {
        predictedConsumptionUntilNextPvKwh = round3(Math.max(forecastNetDemandKwh, learningKwh));
        parts.push(`Verbrauch bis nächstem PV-Fenster max(Forecast ${forecastNetDemandKwh.toFixed(1)} kWh, gelernt ${learningKwh.toFixed(1)} kWh)`);
    }
    else if (forecastKnown) {
        predictedConsumptionUntilNextPvKwh = forecastNetDemandKwh;
        parts.push(`Verbrauch bis nächstem PV-Fenster aus Forecast: ${forecastNetDemandKwh.toFixed(1)} kWh`);
    }
    else if (learningKnown) {
        predictedConsumptionUntilNextPvKwh = learningKwh;
        parts.push(`Kein Forecast — gelernter Nachtverbrauch als Basis: ${learningKwh.toFixed(1)} kWh`);
    }
    else {
        parts.push("Weder Forecast noch gelernter Verbrauch verfügbar.");
    }
    const reserve = (0, reserve_1.resolveRequiredSocAtPvEndPct)({
        predictedNightConsumptionKwh: predictedConsumptionUntilNextPvKwh,
        usableCapacityKwh: input.usableCapacityKwh,
        safetyMarginFraction: input.safetyMarginFraction,
    });
    /*
     * Zusammenführen statt Konkurrenz: nie unter dem bereits vorhandenen kombinierten
     * Lade-/Reserveziel der battery.charge-Contribution (planDynamicBatteryEndSoc +
     * planBatteryChargeLogic, deckt mehrtägiges PV-Defizit ab).
     */
    let requiredSocAtPvEndPct = reserve.requiredSocAtPvEndPct;
    if (input.contributionTargetSocPct !== null && Number.isFinite(input.contributionTargetSocPct)) {
        if (requiredSocAtPvEndPct === null || input.contributionTargetSocPct > requiredSocAtPvEndPct) {
            requiredSocAtPvEndPct = round1(input.contributionTargetSocPct);
            parts.push(`Bestehendes Lade-/Reserveziel (battery.charge, ${input.contributionTargetSocPct.toFixed(0)} %) ist maßgeblich.`);
        }
    }
    if (requiredSocAtPvEndPct !== null) {
        parts.push(reserve.reasonDe);
    }
    const hoursUntilNextReliablePv = nextReliable.startMs !== null ? round3((nextReliable.startMs - input.nowMs) / 3_600_000) : null;
    // estimatedBatteryEmptyAt: Rate aus demselben Verbrauchs-/Zeitfenster ableiten (keine dritte Annahme).
    let estimatedBatteryEmptyAtIso = null;
    if (input.socPct !== null &&
        input.usableCapacityKwh !== null &&
        input.usableCapacityKwh > 0 &&
        predictedConsumptionUntilNextPvKwh !== null &&
        predictedConsumptionUntilNextPvKwh > 0 &&
        hoursUntilNextReliablePv !== null &&
        hoursUntilNextReliablePv > 0) {
        const rateKwPerHour = predictedConsumptionUntilNextPvKwh / hoursUntilNextReliablePv;
        if (rateKwPerHour > 0) {
            const socKwh = (input.socPct / 100) * input.usableCapacityKwh;
            const hoursToEmpty = socKwh / rateKwPerHour;
            estimatedBatteryEmptyAtIso = new Date(input.nowMs + hoursToEmpty * 3_600_000).toISOString();
        }
    }
    // Lade-/Zielenergie + realistische Ladezeit (gelernte Ladeleistung, kein theoretisches Maximum).
    let energyToTargetKwh = null;
    let estimatedChargeTimeToTargetHours = null;
    if (requiredSocAtPvEndPct !== null &&
        input.socPct !== null &&
        input.usableCapacityKwh !== null &&
        input.usableCapacityKwh > 0) {
        energyToTargetKwh = round3(Math.max(0, ((requiredSocAtPvEndPct - input.socPct) / 100) * input.usableCapacityKwh));
        if (energyToTargetKwh > 0 && input.avgChargePowerW !== null && input.avgChargePowerW > 0) {
            estimatedChargeTimeToTargetHours = round3(energyToTargetKwh / (input.avgChargePowerW / 1000));
        }
    }
    if (nextReliable.startIso) {
        parts.push(nextReliable.reasonDe);
    }
    return {
        requiredSocAtPvEndPct,
        requiredReserveKwh: reserve.requiredReserveKwh,
        predictedConsumptionUntilNextPvKwh,
        nextReliablePvIso: nextReliable.startIso,
        hoursUntilNextReliablePv,
        estimatedBatteryEmptyAtIso,
        energyToTargetKwh,
        estimatedChargeTimeToTargetHours,
        reasonDe: parts.join(" — ") + ".",
    };
}
exports.resolveCentralBatteryReserveTarget = resolveCentralBatteryReserveTarget;
