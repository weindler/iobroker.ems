/**
 * Speicher-Kompaktierung: Preis-/PV-Forecast-Horizont dedupliziert mit Delta-Referenz.
 *
 * Problem: `PlannerKnowledgeSnapshot.priceSlots`/`pvSlotKwh` enthalten den GESAMTEN
 * Preis-/PV-Horizont (typ. ≥192 15-Min-Slots über mehrere Tage). Der Planner-Input enthält
 * für den aktuellen Slot oft einen Live-PV-Override (`operator/daily_plan/unified/
 * from_forecast_context.ts`), der sich bei fast jedem materiellen Replan minimal ändert.
 * Ein reiner Volltext-Hash über das gesamte Array (wie der bestehende, unveränderte
 * `hashPlannerKnowledgeContent` für die In-Memory-Dedup von `forecastSnapshots` selbst)
 * dedupliziert deshalb praktisch nie — jeder Replan-Zyklus dupliziert den kompletten Horizont
 * erneut, was beobachtet zu ~166 nahezu identischen Kopien/Tag (~2,7 MiB) führte.
 *
 * Lösung (rein auf der Persistenz-Ebene, siehe `persist.ts`): EIN vollständiger Horizont
 * ("Basisrevision") pro tatsächlich strukturell/materiell abweichender Forecast-Lage. Jeder
 * Snapshot referenziert die zuletzt passende Basisrevision und trägt nur das MINIMALE Delta
 * der tatsächlich geänderten Slots. Nur wenn die Abweichung zur aktuellen Basisrevision zu
 * groß ist (viele Slots anders, z. B. echte Preisrevision, oder Horizont/Timeline geändert),
 * wird eine neue vollständige Basisrevision angelegt — genau die vom Nutzer geforderte
 * "nur bei materieller Forecast-Änderung ein neuer vollständiger Snapshot"-Semantik.
 *
 * PFLICHT-FIX (Produktionsbefund 30.08.2026, ~1,6 MB/Tag trotz Kompaktierung): der Preis-/
 * PV-Horizont ist ein ROLLIERENDES Fenster ab „jetzt" — bei jedem 15-Min-Slotwechsel rutschen
 * ALLE Start-Zeitstempel um einen Slot weiter (ältester Slot fällt raus, ein neuer kommt hinten
 * dazu). Ein reiner Index-Vergleich (`a[i][0] !== b[i][0]`, altes `sameTimeline`) hält das für
 * eine „andere Timeline" und erzwingt dadurch alle 15 Minuten eine neue Vollbasis — obwohl sich
 * der eigentliche Forecast-Inhalt kaum geändert hat. Der Abgleich erfolgt deshalb jetzt per
 * Timestamp (Map von Start-ms → Wert), nicht per Array-Position: ein Slot gilt als „von der
 * Basis übernehmbar", wenn sein Start-ms in der Basis existiert UND der Wert gleich ist —
 * unabhängig davon, an welcher Array-Position er in Basis/Snapshot steht. Neue Slots am Ende
 * des rollierenden Fensters (kein Basis-Treffer) werden wie echte Änderungen im Delta
 * mitgeführt. Die eigene Timeline (Start-ms + Slot-Anzahl, 15-Min-Takt) wird dafür kompakt
 * mitgespeichert (siehe `PlannerKnowledgeSnapshot.forecastPriceTimelineStartMs` etc.).
 *
 * Verlustfrei: `rehydrateForecastRevisions` rekonstruiert exakt die zum Snapshot-Zeitpunkt
 * bekannten Arrays (Basis + Delta angewendet) — keine Rundung, keine Interpolation, keine
 * Näherung. In-Memory (nach dem Lesen) ist ein Snapshot ununterscheidbar von einem, der nie
 * kompaktiert wurde — jeder bestehende Leser (Daily Evaluator, `record.ts`-Dedup,
 * `knowledge_time.ts`, Tests) funktioniert unverändert. Alt-Format (Index-Delta gegen die
 * Basis-Arrayposition, vor diesem Fix persistiert) bleibt beim Lesen weiterhin unterstützt.
 */

import { createHash } from "node:crypto";
import { DAY_TELEMETRY_SLOT_MS } from "./constants";
import type { DayTelemetryDayRecord, ForecastHorizonRevision, PlannerKnowledgeSnapshot } from "./types";

/**
 * Ab diesem Anteil unterschiedlicher Slots (ggü. der aktuellen Basisrevision) gilt der
 * Forecast als materiell geändert → neue vollständige Basisrevision statt Delta.
 */
export const FORECAST_HORIZON_DELTA_MAX_RATIO = 0.15;
/** Mindestanzahl Slots, die auch bei kleinem Horizont noch als "nur Delta" akzeptiert werden. */
export const FORECAST_HORIZON_DELTA_MIN_ABS = 6;

type SlotPair = [number, number];

function hashHorizon(priceSlots: SlotPair[], pvSlotKwh: SlotPair[]): string {
	const payload = JSON.stringify({ priceSlots, pvSlotKwh });
	return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function toTsValueMap(slots: SlotPair[]): Map<number, number> {
	const m = new Map<number, number>();
	for (const [ts, v] of slots) m.set(ts, v);
	return m;
}

/** Regulärer, lückenloser 15-Min-Takt — Voraussetzung für die kompakte Start+Anzahl-Timeline. */
function isRegularContiguous(slots: SlotPair[]): boolean {
	for (let i = 1; i < slots.length; i++) {
		if (slots[i][0] - slots[i - 1][0] !== DAY_TELEMETRY_SLOT_MS) return false;
	}
	return true;
}

/**
 * Delta gegenüber der Basis PER TIMESTAMP (nicht per Array-Index) — überlebt einen seit der
 * Basisrevision weitergerückten rollierenden Horizont. `null` = `next` nicht regulär/lückenlos
 * 15-Min-getaktet → kein Timestamp-Delta möglich, Aufrufer muss auf Vollbasis ausweichen.
 */
function diffSlotsByTimestamp(baseMap: Map<number, number>, next: SlotPair[]): SlotPair[] | null {
	if (!isRegularContiguous(next)) return null;
	const delta: SlotPair[] = [];
	for (let i = 0; i < next.length; i++) {
		const ts = next[i][0];
		const v = next[i][1];
		const baseV = baseMap.get(ts);
		if (baseV === undefined || baseV !== v) delta.push([i, v]);
	}
	return delta;
}

function deltaWithinBudget(deltaLen: number, totalLen: number): boolean {
	if (totalLen === 0) return true;
	const budget = Math.max(
		FORECAST_HORIZON_DELTA_MIN_ABS,
		Math.ceil(totalLen * FORECAST_HORIZON_DELTA_MAX_RATIO),
	);
	return deltaLen <= budget;
}

/** Alt-Format (vor dem Timestamp-Fix): Index in der Basis-Arrayposition. Weiterhin lesbar. */
function applyDeltaByIndex(base: SlotPair[], delta: SlotPair[] | undefined): SlotPair[] {
	const out: SlotPair[] = base.map((e) => [e[0], e[1]]);
	if (!delta?.length) return out;
	for (const [idx, val] of delta) {
		if (idx >= 0 && idx < out.length) out[idx] = [out[idx][0], val];
	}
	return out;
}

/**
 * Neues Format: rekonstruiert die EIGENE Timeline des Snapshots (Start-ms + Anzahl, 15-Min-
 * Takt) und übernimmt je Slot entweder den Basis-Wert (per Timestamp-Treffer) oder den
 * Delta-Wert (Index innerhalb dieser eigenen Timeline). Ein Slot ohne Basis-Treffer MUSS im
 * Delta stehen (das garantiert die Kompaktierung) — fehlt er trotzdem (beschädigte/alte Daten),
 * wird er ausgelassen statt einen Wert zu erfinden.
 */
function applyDeltaByTimestamp(
	baseMap: Map<number, number>,
	startMs: number,
	count: number,
	delta: SlotPair[] | undefined,
): SlotPair[] {
	const deltaByIdx = new Map<number, number>(delta ?? []);
	const out: SlotPair[] = [];
	for (let i = 0; i < count; i++) {
		const ts = startMs + i * DAY_TELEMETRY_SLOT_MS;
		const v = deltaByIdx.has(i) ? deltaByIdx.get(i)! : baseMap.get(ts);
		if (v === undefined) continue;
		out.push([ts, v]);
	}
	return out;
}

/**
 * Kompaktiert `day.forecastSnapshots` für die Persistenz: extrahiert deduplizierte
 * Basisrevisionen (`forecastRevisions`) und ersetzt volle Preis-/PV-Arrays je Snapshot durch
 * eine Referenz (`forecastRevisionId`) + minimalem Delta. Baut IMMER frisch aus den (in-memory
 * stets vollständigen) `day.forecastSnapshots` auf — deterministisch, kein Drift durch alte
 * Zwischenstände. Gibt ein NEUES Objekt zurück; `day` selbst (z. B. der In-Memory-Dedup-Cache
 * in `record.ts`) bleibt unverändert und behält seine vollen Arrays.
 */
export function compactForecastSnapshotsForPersist(day: DayTelemetryDayRecord): DayTelemetryDayRecord {
	if (!day.forecastSnapshots?.length) return day;

	const revisions: ForecastHorizonRevision[] = [];
	let currentBase: ForecastHorizonRevision | null = null;
	let currentBasePriceMap: Map<number, number> | null = null;
	let currentBasePvMap: Map<number, number> | null = null;

	const compactSnapshots: PlannerKnowledgeSnapshot[] = day.forecastSnapshots.map((snap) => {
		const priceDelta = currentBasePriceMap ? diffSlotsByTimestamp(currentBasePriceMap, snap.priceSlots) : null;
		const pvDelta = currentBasePvMap ? diffSlotsByTimestamp(currentBasePvMap, snap.pvSlotKwh) : null;
		const canDelta =
			currentBase != null &&
			priceDelta != null &&
			pvDelta != null &&
			deltaWithinBudget(priceDelta.length, snap.priceSlots.length) &&
			deltaWithinBudget(pvDelta.length, snap.pvSlotKwh.length);

		if (canDelta && currentBase && priceDelta && pvDelta) {
			return {
				...snap,
				priceSlots: [],
				pvSlotKwh: [],
				forecastRevisionId: currentBase.id,
				forecastPriceTimelineStartMs: snap.priceSlots[0]?.[0],
				forecastPriceSlotCount: snap.priceSlots.length,
				forecastPvTimelineStartMs: snap.pvSlotKwh[0]?.[0],
				forecastPvSlotCount: snap.pvSlotKwh.length,
				forecastPriceDelta: priceDelta.length ? priceDelta : undefined,
				forecastPvDelta: pvDelta.length ? pvDelta : undefined,
			};
		}

		/* Materielle Abweichung (oder erste Revision dieses Tages) → neue vollständige Basis. */
		const id = hashHorizon(snap.priceSlots, snap.pvSlotKwh);
		const existing = revisions.find((r) => r.id === id);
		const rev: ForecastHorizonRevision =
			existing ?? { id, tsIso: snap.tsIso, priceSlots: snap.priceSlots, pvSlotKwh: snap.pvSlotKwh };
		if (!existing) revisions.push(rev);
		currentBase = rev;
		currentBasePriceMap = toTsValueMap(rev.priceSlots);
		currentBasePvMap = toTsValueMap(rev.pvSlotKwh);
		return {
			...snap,
			priceSlots: [],
			pvSlotKwh: [],
			forecastRevisionId: rev.id,
			forecastPriceTimelineStartMs: undefined,
			forecastPriceSlotCount: undefined,
			forecastPvTimelineStartMs: undefined,
			forecastPvSlotCount: undefined,
			forecastPriceDelta: undefined,
			forecastPvDelta: undefined,
		};
	});

	return { ...day, forecastSnapshots: compactSnapshots, forecastRevisions: revisions };
}

/**
 * Rekonstruiert `priceSlots`/`pvSlotKwh` für jeden kompaktierten Snapshot verlustfrei
 * (Basisrevision + Delta). Mutiert `day` in place — nur direkt nach dem Einlesen (JSON.parse)
 * aufrufen, analog zu den übrigen Normalisierungsschritten in `persist.ts`. Snapshots ohne
 * `forecastRevisionId` (ältere Tagesdateien mit noch vollständig inline gespeicherten Arrays)
 * bleiben unverändert — volle Rückwärtskompatibilität.
 */
export function rehydrateForecastRevisions(day: DayTelemetryDayRecord): void {
	if (!Array.isArray(day.forecastRevisions) || day.forecastRevisions.length === 0) return;
	if (!Array.isArray(day.forecastSnapshots) || day.forecastSnapshots.length === 0) return;
	const byId = new Map(day.forecastRevisions.map((r) => [r.id, r]));
	for (const snap of day.forecastSnapshots) {
		const revId = snap.forecastRevisionId;
		if (!revId) continue;
		const rev = byId.get(revId);
		if (!rev) continue;

		if (snap.forecastPriceTimelineStartMs != null && snap.forecastPriceSlotCount != null) {
			snap.priceSlots = applyDeltaByTimestamp(
				toTsValueMap(rev.priceSlots),
				snap.forecastPriceTimelineStartMs,
				snap.forecastPriceSlotCount,
				snap.forecastPriceDelta,
			);
		} else {
			snap.priceSlots = applyDeltaByIndex(rev.priceSlots, snap.forecastPriceDelta);
		}

		if (snap.forecastPvTimelineStartMs != null && snap.forecastPvSlotCount != null) {
			snap.pvSlotKwh = applyDeltaByTimestamp(
				toTsValueMap(rev.pvSlotKwh),
				snap.forecastPvTimelineStartMs,
				snap.forecastPvSlotCount,
				snap.forecastPvDelta,
			);
		} else {
			snap.pvSlotKwh = applyDeltaByIndex(rev.pvSlotKwh, snap.forecastPvDelta);
		}
	}
}
