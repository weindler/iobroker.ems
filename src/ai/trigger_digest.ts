import type { DailyPlan } from "../operator/daily_plan/types";

/** Grobes Energie-Raster (kWh) — Änderungen unterhalb gelten als Rauschen, nicht als neuer Plan. */
export const AI_TRIGGER_ENERGY_BUCKET_KWH = 0.3;
/** Grobes PV-Tagesprognose-Raster (kWh) — deutlich größer, da Tagessummen im zweistelligen kWh-Bereich liegen. */
export const AI_TRIGGER_PV_BUCKET_KWH = 2;
/** Grobes Netzkosten-Raster (ct). */
export const AI_TRIGGER_COST_BUCKET_CT = 50;

function bucket(value: number | null, size: number): number | null {
	if (value === null || !Number.isFinite(value) || size <= 0) return null;
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
 * Dieser Digest enthält deshalb bewusst NICHT die 15-Minuten-Slot-Liste, sondern nur:
 * - Kalendertag, Global Mode, Plan-Status
 * - welche Add-ons überhaupt aktiv/ausgeschlossen sind (nicht: wie viel W in welchem Slot)
 * - grob gerasterte Gesamt-Energiemengen (Flex-Bedarf/-Allocation/-Rest, PV-Tagesprognose, Netzkosten)
 *
 * Ein Trigger erfolgt damit nur bei Ereignissen wie: Add-on-Bedarf startet/endet, Zieltemperatur
 * springt eine Stufe (wirkt sich auf `flexibleRequestedEnergyKwh` aus), PV-Tagesprognose ändert
 * sich deutlich, Tageswechsel, Global-Mode-Wechsel — nicht bei jedem Tick.
 */
export function aiTriggerDigestPayload(plan: DailyPlan): string {
	return JSON.stringify({
		date: plan.date,
		globalMode: plan.globalMode,
		status: plan.status,
		activeContributionIds: [...plan.activeContributionIds].sort(),
		excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId).sort(),
		flexibleRequestedEnergyKwhBucket: bucket(
			plan.totals.flexibleRequestedEnergyKwh,
			AI_TRIGGER_ENERGY_BUCKET_KWH,
		),
		flexibleAllocatedEnergyKwhBucket: bucket(
			plan.totals.flexibleAllocatedEnergyKwh,
			AI_TRIGGER_ENERGY_BUCKET_KWH,
		),
		flexibleUnallocatedEnergyKwhBucket: bucket(
			plan.totals.flexibleUnallocatedEnergyKwh,
			AI_TRIGGER_ENERGY_BUCKET_KWH,
		),
		pvForecastEnergyKwhBucket: bucket(plan.totals.pvForecastEnergyKwh, AI_TRIGGER_PV_BUCKET_KWH),
		estimatedGridCostCtBucket: bucket(plan.totals.estimatedGridCostCt, AI_TRIGGER_COST_BUCKET_CT),
	});
}
