"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.aiTriggerDigestPayload = exports.aiMaterialFlexFamilies = exports.priceStructureDigestFromPlan = exports.medianGridPriceCtPerKwh = exports.AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT = exports.AI_TRIGGER_PV_BUCKET_KWH = exports.AI_TRIGGER_ENERGY_BUCKET_KWH = void 0;
/** Grobes Energie-Raster (kWh) — Änderungen unterhalb gelten als Rauschen, nicht als neuer Plan. */
exports.AI_TRIGGER_ENERGY_BUCKET_KWH = 0.3;
/** Grobes PV-Tagesprognose-Raster (kWh) — deutlich größer, da Tagessummen im zweistelligen kWh-Bereich liegen. */
exports.AI_TRIGGER_PV_BUCKET_KWH = 2;
/**
 * Grobes Median-Preis-Raster (ct/kWh) — Block 10.2: wesentliche Preisstruktur-Änderung
 * (Masterplan §13), ohne jeden Slot-Roll zu feuern.
 */
exports.AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT = 5;
function bucket(value, size) {
    if (value === null || !Number.isFinite(value) || size <= 0)
        return null;
    return Math.round(value / size) * size;
}
/** Median der Slot-Netzpreise; null wenn keine Preise vorliegen. */
function medianGridPriceCtPerKwh(plan) {
    const prices = [];
    for (const slot of plan.slots) {
        const p = slot.gridPriceCtPerKwh;
        if (p !== null && Number.isFinite(p))
            prices.push(p);
    }
    if (prices.length === 0)
        return null;
    prices.sort((a, b) => a - b);
    return prices[Math.floor(prices.length / 2)];
}
exports.medianGridPriceCtPerKwh = medianGridPriceCtPerKwh;
/**
 * Kompakter Preisstruktur-Digest: Median-Bucket + Lage günstiger/teurer Bereiche.
 * Erkennt Verschiebungen günstiger Fenster bei ähnlichem Median — ohne fixe Nachtregel.
 */
function priceStructureDigestFromPlan(plan) {
    const priced = [];
    for (const slot of plan.slots) {
        const p = slot.gridPriceCtPerKwh;
        if (p !== null && Number.isFinite(p)) {
            priced.push({ startIso: slot.slot.startIso, p });
        }
    }
    if (priced.length === 0) {
        return JSON.stringify({ empty: true });
    }
    const sorted = [...priced].sort((a, b) => a.p - b.p);
    const prices = sorted.map((x) => x.p);
    const q25 = prices[Math.floor((prices.length - 1) * 0.25)];
    const q75 = prices[Math.floor((prices.length - 1) * 0.75)];
    const median = prices[Math.floor(prices.length / 2)];
    // Stunde (UTC ISO) der günstigsten/teuersten Quartile — Zeitlage ohne Tageszeit-Hardcode
    const cheapHours = [
        ...new Set(priced
            .filter((x) => x.p <= q25 + 1e-9)
            .map((x) => x.startIso.slice(0, 13))),
    ].sort();
    const dearHours = [
        ...new Set(priced
            .filter((x) => x.p >= q75 - 1e-9)
            .map((x) => x.startIso.slice(0, 13))),
    ].sort();
    const cheapestStart = sorted[0].startIso.slice(0, 13);
    return JSON.stringify({
        medianBucket: bucket(median, exports.AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT),
        q25Bucket: bucket(q25, exports.AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT),
        q75Bucket: bucket(q75, exports.AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT),
        cheapestHour: cheapestStart,
        cheapHours,
        dearHours,
    });
}
exports.priceStructureDigestFromPlan = priceStructureDigestFromPlan;
/**
 * Welche KI-relevanten Contribution-Familien im Plan aktiv sind (Vehicle angesteckt,
 * Batterie-Ladebedarf, IH/Klima flex) — grober Material-Change ohne Slot-Watt-Rauschen.
 */
function aiMaterialFlexFamilies(plan) {
    const families = new Set();
    for (const id of plan.activeContributionIds) {
        if (id.startsWith("immersion_heater"))
            families.add("immersion_heater");
        else if (id.startsWith("air_conditioning"))
            families.add("climate");
        else if (id.startsWith("battery.charge"))
            families.add("battery");
        else if (id.startsWith("wallbox"))
            families.add("wallbox");
    }
    return [...families].sort();
}
exports.aiMaterialFlexFamilies = aiMaterialFlexFamilies;
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
 * - KI-relevante Flex-Familien (IH/Klima/Batterie-Laden/Wallbox) — Block 10.2
 * - grob gerasterten Flex-**Bedarf**, PV-Tagesprognose, Median-Netzpreis
 *
 * Ein Trigger erfolgt damit nur bei Ereignissen wie: Add-on-Bedarf startet/endet, Zieltemperatur
 * springt eine Stufe, PV-Tagesprognose ändert sich deutlich, wesentliche Preisstruktur-Änderung,
 * Tageswechsel, Global-Mode-Wechsel — nicht bei jedem Tick und nicht bei Allocation-Fortschritt.
 */
function aiTriggerDigestPayload(plan) {
    return JSON.stringify({
        date: plan.date,
        globalMode: plan.globalMode,
        status: plan.status,
        activeContributionIds: [...plan.activeContributionIds].sort(),
        excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId).sort(),
        aiMaterialFlexFamilies: aiMaterialFlexFamilies(plan),
        flexibleRequestedEnergyKwhBucket: bucket(plan.totals.flexibleRequestedEnergyKwh, exports.AI_TRIGGER_ENERGY_BUCKET_KWH),
        pvForecastEnergyKwhBucket: bucket(plan.totals.pvForecastEnergyKwh, exports.AI_TRIGGER_PV_BUCKET_KWH),
        priceMedianCtBucket: bucket(medianGridPriceCtPerKwh(plan), exports.AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT),
        priceStructure: priceStructureDigestFromPlan(plan),
    });
}
exports.aiTriggerDigestPayload = aiTriggerDigestPayload;
