import type { DailyPlan } from "../operator/daily_plan/types";

/** Grobes Energie-Raster (kWh) — Änderungen unterhalb gelten als Rauschen, nicht als neuer Plan. */
export const AI_TRIGGER_ENERGY_BUCKET_KWH = 0.3;
/** Grobes PV-Tagesprognose-Raster (kWh) — deutlich größer, da Tagessummen im zweistelligen kWh-Bereich liegen. */
export const AI_TRIGGER_PV_BUCKET_KWH = 2;
/**
 * Grobes Median-Preis-Raster (ct/kWh) — Block 10.2: wesentliche Preisstruktur-Änderung
 * (Masterplan §13), ohne jeden Slot-Roll zu feuern.
 */
export const AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT = 5;

function bucket(value: number | null, size: number): number | null {
	if (value === null || !Number.isFinite(value) || size <= 0) return null;
	return Math.round(value / size) * size;
}

/** Median der Slot-Netzpreise; null wenn keine Preise vorliegen. */
export function medianGridPriceCtPerKwh(plan: DailyPlan): number | null {
	const prices: number[] = [];
	for (const slot of plan.slots) {
		const p = slot.gridPriceCtPerKwh;
		if (p !== null && Number.isFinite(p)) prices.push(p);
	}
	if (prices.length === 0) return null;
	prices.sort((a, b) => a - b);
	return prices[Math.floor(prices.length / 2)]!;
}

/**
 * Welche KI-relevanten Contribution-Familien im Plan aktiv sind (Vehicle angesteckt,
 * Batterie-Ladebedarf, IH/Klima flex) — grober Material-Change ohne Slot-Watt-Rauschen.
 */
export function aiMaterialFlexFamilies(plan: DailyPlan): string[] {
	const families = new Set<string>();
	for (const id of plan.activeContributionIds) {
		if (id.startsWith("immersion_heater")) families.add("immersion_heater");
		else if (id.startsWith("air_conditioning")) families.add("climate");
		else if (id.startsWith("battery.charge")) families.add("battery");
		else if (id.startsWith("wallbox")) families.add("wallbox");
	}
	return [...families].sort();
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
 * - KI-relevante Flex-Familien (IH/Klima/Batterie-Laden/Wallbox) — Block 10.2
 * - grob gerasterten Flex-**Bedarf**, PV-Tagesprognose, Median-Netzpreis
 *
 * Ein Trigger erfolgt damit nur bei Ereignissen wie: Add-on-Bedarf startet/endet, Zieltemperatur
 * springt eine Stufe, PV-Tagesprognose ändert sich deutlich, wesentliche Preisstruktur-Änderung,
 * Tageswechsel, Global-Mode-Wechsel — nicht bei jedem Tick und nicht bei Allocation-Fortschritt.
 */
export function aiTriggerDigestPayload(plan: DailyPlan): string {
	return JSON.stringify({
		date: plan.date,
		globalMode: plan.globalMode,
		status: plan.status,
		activeContributionIds: [...plan.activeContributionIds].sort(),
		excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId).sort(),
		aiMaterialFlexFamilies: aiMaterialFlexFamilies(plan),
		flexibleRequestedEnergyKwhBucket: bucket(
			plan.totals.flexibleRequestedEnergyKwh,
			AI_TRIGGER_ENERGY_BUCKET_KWH,
		),
		pvForecastEnergyKwhBucket: bucket(plan.totals.pvForecastEnergyKwh, AI_TRIGGER_PV_BUCKET_KWH),
		priceMedianCtBucket: bucket(medianGridPriceCtPerKwh(plan), AI_TRIGGER_PRICE_MEDIAN_BUCKET_CT),
	});
}
