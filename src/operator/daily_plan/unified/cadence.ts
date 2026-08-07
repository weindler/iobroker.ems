/**
 * Unified/Daily-Plan Cadence — wiederverwendet den bestehenden Material-Digest
 * (`aiTriggerDigestPayload`), der bewusst Slot-Rollen und Telemetrie-Rauschen ausblendet.
 *
 * Kein zweiter Scheduler: der ~60-s-Tick prüft nur, ob ein neuer Plan fachlich nötig ist.
 */

import {
	aiTriggerDigestPayload,
	AI_TRIGGER_ENERGY_BUCKET_KWH,
} from "../../../ai/trigger_digest";
import type { DailyPlan } from "../types";

function bucket(value: number | null | undefined, size: number): number | null {
	if (value === null || value === undefined || !Number.isFinite(value) || size <= 0) return null;
	return Math.round(value / size) * size;
}

/**
 * Fingerabdruck für „soll ein neuer Tages-/Unified-Plan erzeugt werden?“.
 * Enthält u. a. lokalen Kalendertag (→ Tageswechsel), PV-/Preis-Buckets,
 * aktive Flex-Familien (Wallbox connected, IH/Klima/Batterie), groben Energiebedarf.
 */
export function unifiedPlanCadenceDigest(plan: DailyPlan): string {
	return JSON.stringify({
		material: aiTriggerDigestPayload(plan),
		houseLoadEnergyKwhBucket: bucket(plan.totals.fixedHouseLoadEnergyKwh, AI_TRIGGER_ENERGY_BUCKET_KWH),
	});
}
