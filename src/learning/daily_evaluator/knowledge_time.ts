/**
 * BLOCK A — Knowledge-Time-Resolver.
 *
 * Trennt strikt "was war zum Entscheidungszeitpunkt bekannt" (Snapshot/Forecast) von
 * "was ist tatsächlich passiert" (Telemetrie-Buckets, reale Preise). Keine Rekonstruktion
 * historischer Entscheidungen mit heutiger Config/heutigem Runtime-State — wenn zu einem
 * Zeitpunkt kein Snapshot existiert, ist decisionQuality für diesen Zeitpunkt insufficient_data.
 */

import type { DayTelemetryDayRecord, PlannerKnowledgeSnapshot } from "../day_telemetry/types";

/** Letzter Snapshot mit tsIso <= atMs — null wenn keiner existiert (kein Fallback auf später/früher erfinden). */
export function resolveKnowledgeSnapshotAt(
	day: DayTelemetryDayRecord,
	atMs: number,
): PlannerKnowledgeSnapshot | null {
	let best: PlannerKnowledgeSnapshot | null = null;
	let bestMs = -Infinity;
	for (const s of day.forecastSnapshots) {
		const ms = Date.parse(s.tsIso);
		if (!Number.isFinite(ms) || ms > atMs) continue;
		if (ms > bestMs) {
			bestMs = ms;
			best = s;
		}
	}
	return best;
}

/**
 * Zum Entscheidungszeitpunkt bekannter Preis für einen Slot-Start (ct/kWh) — aus
 * snapshot.priceSlots (Forecast/Tarif-Snapshot zum Zeitpunkt der Entscheidung), NICHT
 * der tatsächliche Preis. Exaktes Slot-Start-Match; kein Interpolieren.
 */
export function resolveKnownPriceAtSlotStart(
	snapshot: PlannerKnowledgeSnapshot | null,
	slotStartMs: number,
): number | null {
	if (!snapshot) return null;
	for (const [startMs, ct] of snapshot.priceSlots) {
		if (startMs === slotStartMs) return ct;
	}
	return null;
}

/**
 * Perzentil (0–1) eines Preiswerts innerhalb der zum Entscheidungszeitpunkt bekannten
 * Preisreihe (priceSlots desselben Snapshots) — 0 = günstigstes bekanntes Fenster,
 * 1 = teuerstes. null wenn Preisreihe zu kurz (< 4 Slots) für eine sinnvolle Einordnung.
 */
export function priceRankPercentileAtDecisionTime(
	snapshot: PlannerKnowledgeSnapshot | null,
	priceCtPerKwh: number | null,
): number | null {
	if (!snapshot || priceCtPerKwh == null || !Number.isFinite(priceCtPerKwh)) return null;
	const values = snapshot.priceSlots.map(([, ct]) => ct).filter((v) => Number.isFinite(v));
	if (values.length < 4) return null;
	const sorted = [...values].sort((a, b) => a - b);
	let below = 0;
	for (const v of sorted) if (v < priceCtPerKwh) below++;
	return below / sorted.length;
}
