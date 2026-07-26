"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiTriggerDigestPayload = exports.AI_TRIGGER_COST_BUCKET_CT = exports.AI_TRIGGER_PV_BUCKET_KWH = exports.AI_TRIGGER_ENERGY_BUCKET_KWH = void 0;
/** Grobes Energie-Raster (kWh) — Änderungen unterhalb gelten als Rauschen, nicht als neuer Plan. */
exports.AI_TRIGGER_ENERGY_BUCKET_KWH = 0.3;
/** Grobes PV-Tagesprognose-Raster (kWh) — deutlich größer, da Tagessummen im zweistelligen kWh-Bereich liegen. */
exports.AI_TRIGGER_PV_BUCKET_KWH = 2;
/** Grobes Netzkosten-Raster (ct). */
exports.AI_TRIGGER_COST_BUCKET_CT = 50;
function bucket(value, size) {
    if (value === null || !Number.isFinite(value) || size <= 0)
        return null;
    return Math.round(value / size) * size;
}
/**
 * Bewusst grober "hat sich wirklich etwas geändert?"-Fingerabdruck für die automatische
 * KI-Auslösung — getrennt von `dailyPlanRevisionPayload` (Operator-Revision).
 *
 * Die Operator-Revision wechselt bei praktisch jedem EMS-Tick: der 15-Minuten-Horizont rollt
 * weiter (ein Slot fällt hinten weg, einer kommt vorne dazu), die Allocation arbeitet Slot für
 * Slot die Restenergie ab, PV-Kurve/Puffer-Temperatur zittern im Zehntelgrad-Bereich. Jede dieser
 * Änderungen ist für EMS relevant (Daily Plan muss exakt bleiben), aber für die reine
 * Plan-Vergleich-Beobachtung durch die KI ist sie Rauschen — sie hätte sonst mehrfach pro Stunde
 * einen KI-Call ausgelöst und das Tageslimit unnötig verbraucht.
 *
 * Dieser Digest enthält deshalb bewusst NICHT die 15-Minuten-Slot-Liste und auch nicht den
 * Allocation-Fortschritt (zugewiesen/unallokiert), sondern nur:
 * - Kalendertag, Global Mode, Plan-Status
 * - welche Add-ons überhaupt aktiv/ausgeschlossen sind (nicht: wie viel W in welchem Slot)
 * - grob gerasterten Flex-**Bedarf** (nicht: wie viel schon zugeteilt wurde), PV-Tagesprognose, Netzkosten
 *
 * Ein Trigger erfolgt damit nur bei Ereignissen wie: Add-on-Bedarf startet/endet, Zieltemperatur
 * springt eine Stufe (wirkt sich auf `flexibleRequestedEnergyKwh` aus), PV-Tagesprognose ändert
 * sich deutlich, Tageswechsel, Global-Mode-Wechsel — nicht bei jedem Tick und nicht wenn sich nur
 * der Slot-für-Slot-Allocation-Fortschritt ändert (v0.1.194).
 */
function aiTriggerDigestPayload(plan) {
    return JSON.stringify({
        date: plan.date,
        globalMode: plan.globalMode,
        status: plan.status,
        activeContributionIds: [...plan.activeContributionIds].sort(),
        excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId).sort(),
        flexibleRequestedEnergyKwhBucket: bucket(plan.totals.flexibleRequestedEnergyKwh, exports.AI_TRIGGER_ENERGY_BUCKET_KWH),
        pvForecastEnergyKwhBucket: bucket(plan.totals.pvForecastEnergyKwh, exports.AI_TRIGGER_PV_BUCKET_KWH),
        estimatedGridCostCtBucket: bucket(plan.totals.estimatedGridCostCt, exports.AI_TRIGGER_COST_BUCKET_CT),
    });
}
exports.aiTriggerDigestPayload = aiTriggerDigestPayload;
