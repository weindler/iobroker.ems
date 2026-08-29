"use strict";
/**
 * Gemeinsame thermische Reserve-Bewertung für den Heizstab (Block: Heizstab-/Thermal-Reichweite
 * gegen nächstes PV-/Energiefenster und zentrale Batterie-Reserve).
 *
 * Führt bestehende Signale ZUSAMMEN, statt eine neue Optimierung/dritte Logik zu bauen:
 * - Boiler-/Puffer-Learning (`estimatedRemainingHours`, `estimatedEmptyAt`) — unverändert.
 * - `resolveThermalPvPrecharge` (thermal_pv_precharge.ts) — unverändert, bleibt die eigentliche
 *   Vorlade-Ökonomie. Diese Datei sorgt nur dafür, dass sie mit REALEN statt fehlenden Inputs
 *   aufgerufen wird (`nextPvHeatOpportunityIso` war in Produktion bislang immer `null`).
 * - `operator/contributions/flexible/immersion_night_bridge.ts` → `nextBridgeUntilIso()` als
 *   bestehender, deterministischer Uhrzeit-Anker („nächster Morgen“), wenn kein mehrtägiges
 *   PV-Defizit vorliegt.
 * - `battery_charge_logic.ts` (`chargeLogic.bridgeUntilIso`) — bereits berechnetes mehrtägiges
 *   PV-Defizit-Ende, für „schwacher Forecast morgen → Reserve heute sinnvoll“.
 * - `policy/battery_consumers` (`mayUseBattery`) + zentrale Batterie-Reserve
 *   (`planner.battery_reserve.required_soc_at_pv_end_pct`, Batterie-Block) — ersetzt/ergänzt das
 *   bisherige `batteryEndSocTargetPct` und blendet Batteriesignale ganz aus, wenn die Policy
 *   der Batterie für den Heizstab verbietet.
 *
 * Harte Regeln (Hygiene, kritische Mindesttemperatur, Safety, echte Deadlines) laufen weiterhin
 * über `buildImmersionMandatoryContribution` — unverändert und unabhängig von dieser Datei.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateThermalReserveDiagnostics = exports.resolveNextPvHeatOpportunityIso = exports.gateBatteryInputsForThermalPrecharge = void 0;
const immersion_night_bridge_1 = require("./immersion_night_bridge");
/**
 * Blendet Batterie-Signale für die Vorladung aus, wenn die Policy dem Heizstab die Batterie
 * gerade nicht erlaubt — sonst würde `resolveThermalPvPrecharge` „Batterie satt“ als Grund für
 * mehr Vorladung werten, obwohl der Heizstab davon nie hätte profitieren dürfen. Ist Batterie
 * erlaubt, wird das zentrale Reserve-Ziel wiederverwendet statt eine zweite Batterie-Logik.
 */
function gateBatteryInputsForThermalPrecharge(input) {
    if (input.mayUseBatteryForImmersion === false) {
        return {
            batterySocPct: null,
            batteryEndSocTargetPct: null,
            reasonDe: "Policy: Batterie für Heizstab nicht erlaubt — Batteriesignal für Vorladung ausgeblendet.",
        };
    }
    const target = input.centralBatteryReserveRequiredSocAtPvEndPct ?? input.legacyBatteryEndSocTargetPct ?? null;
    return {
        batterySocPct: input.batterySocPct,
        batteryEndSocTargetPct: target,
        reasonDe: input.centralBatteryReserveRequiredSocAtPvEndPct !== null
            ? "Zentrale Batterie-Reserve als Vorladungs-Referenz verwendet."
            : target !== null
                ? "Kein zentrales Reserveziel bekannt — Legacy-Ladeziel der battery.charge-Contribution verwendet."
                : "Kein Batterie-Ladeziel bekannt.",
    };
}
exports.gateBatteryInputsForThermalPrecharge = gateBatteryInputsForThermalPrecharge;
/**
 * Nächstes verlässliches PV-/Energiefenster für die thermische Vorladung — reine Priorität
 * bestehender Quellen, keine neue Berechnung:
 * 1) explizit übergeben (z. B. aus einem künftigen Slot-Forecast)
 * 2) mehrtägiges PV-Defizit-Ende (`battery_charge_logic.ts`, bereits berechnet)
 * 3) nächster Morgen (`immersion_night_bridge.ts`, bestehender Uhrzeit-Anker)
 */
function resolveNextPvHeatOpportunityIso(input) {
    if (input.explicitIso)
        return input.explicitIso;
    if (input.pvDeficitBridgeUntilIso)
        return input.pvDeficitBridgeUntilIso;
    return (0, immersion_night_bridge_1.nextBridgeUntilIso)(input.now, input.timezone?.trim() || "Europe/Berlin");
}
exports.resolveNextPvHeatOpportunityIso = resolveNextPvHeatOpportunityIso;
function round1(n) {
    return Math.round(n * 10) / 10;
}
function evaluateThermalReserveDiagnostics(input) {
    const hoursUntilNextPvHeatOpportunity = input.nextPvHeatOpportunityIso
        ? Math.max(0, (Date.parse(input.nextPvHeatOpportunityIso) - input.nowMs) / 3_600_000)
        : null;
    const remainingKnown = input.estimatedRemainingHours !== null && Number.isFinite(input.estimatedRemainingHours);
    const nextPvKnown = hoursUntilNextPvHeatOpportunity !== null && Number.isFinite(hoursUntilNextPvHeatOpportunity);
    const prechargeActive = input.precharge?.active === true;
    const reserveAtRisk = remainingKnown && nextPvKnown && input.estimatedRemainingHours < hoursUntilNextPvHeatOpportunity;
    /*
     * „Heizen ahead of strict need“ im weiteren Sinn: entweder die eigentliche Vorladung
     * (resolveThermalPvPrecharge) ist aktiv, ODER die Nachtbrücke musste das Ziel bereits
     * anheben, weil die Reichweite knapp ist (dann bleibt Precharge selbst korrekt inaktiv,
     * weil kein Headroom mehr über dem bereits angehobenen Ziel liegt).
     */
    const prechargeNeeded = prechargeActive || (reserveAtRisk && input.nightBridgeActive === true);
    const parts = [];
    let energySourceClass;
    if (!remainingKnown && !nextPvKnown) {
        energySourceClass = "insufficient_data";
        parts.push("Weder thermische Restreichweite noch nächstes PV-Fenster bekannt — konservative Basis-Planung.");
    }
    else if (prechargeActive) {
        energySourceClass = "pv_surplus";
        parts.push("Vorladung aktiv — Bedarf über PV-Überschuss geplant.");
    }
    else if (remainingKnown && nextPvKnown) {
        if (input.estimatedRemainingHours >= hoursUntilNextPvHeatOpportunity) {
            energySourceClass = "sufficient_no_precharge";
            parts.push(`Reichweite ~${round1(input.estimatedRemainingHours)} h reicht bis zum nächsten PV-Fenster in ~${round1(hoursUntilNextPvHeatOpportunity)} h — kein Vorladen nötig.`);
        }
        else if (input.mayUseBatteryForImmersion === false) {
            energySourceClass = "battery_excluded_by_policy";
            parts.push(`Reichweite ~${round1(input.estimatedRemainingHours)} h reicht NICHT bis zum nächsten PV-Fenster in ~${round1(hoursUntilNextPvHeatOpportunity)} h — Batterie für Heizstab nicht erlaubt, kein Vorladen ohne echten PV-Überschuss.`);
        }
        else {
            energySourceClass = "reserve_at_risk";
            parts.push(`Reichweite ~${round1(input.estimatedRemainingHours)} h reicht NICHT bis zum nächsten PV-Fenster in ~${round1(hoursUntilNextPvHeatOpportunity)} h — Vorladung wirtschaftlich zu prüfen.`);
        }
    }
    else if (input.mayUseBatteryForImmersion === false) {
        energySourceClass = "battery_excluded_by_policy";
        parts.push("Batterie für Heizstab nicht erlaubt — kein Vorladen ohne echten PV-Überschuss.");
    }
    else {
        energySourceClass = "insufficient_data";
        parts.push("Nur teilweise Daten (Restreichweite oder nächstes PV-Fenster fehlt) — konservative Basis-Planung.");
    }
    if (remainingKnown)
        parts.push(`Restreichweite ~${round1(input.estimatedRemainingHours)} h`);
    if (nextPvKnown)
        parts.push(`nächstes PV-Fenster in ~${round1(hoursUntilNextPvHeatOpportunity)} h`);
    if (input.precharge?.reasonDe)
        parts.push(input.precharge.reasonDe);
    return {
        estimatedRemainingHours: input.estimatedRemainingHours,
        estimatedEmptyAtIso: input.estimatedEmptyAtIso,
        nextPvHeatOpportunityIso: input.nextPvHeatOpportunityIso,
        hoursUntilNextPvHeatOpportunity: hoursUntilNextPvHeatOpportunity !== null ? round1(hoursUntilNextPvHeatOpportunity) : null,
        prechargeNeeded,
        energySourceClass,
        reasonDe: parts.join(" — ") + ".",
    };
}
exports.evaluateThermalReserveDiagnostics = evaluateThermalReserveDiagnostics;
