import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	FORECAST_HORIZON_DELTA_MAX_RATIO,
	FORECAST_HORIZON_DELTA_MIN_ABS,
	compactForecastSnapshotsForPersist,
	rehydrateForecastRevisions,
} from "./forecast_horizon.js";
import { emptyDayRecord, type PlannerKnowledgeSnapshot } from "./types.js";
import { buildDaySlotLayout } from "./slots.js";

const TZ = "Europe/Berlin";
const HORIZON_SLOTS = 192; /* 48h @ 15 Min — realistischer Multi-Tage-Preis-/PV-Horizont. */

function horizonSlots(
	horizonStartMs: number,
	value: (i: number) => number,
): Array<[number, number]> {
	return Array.from({ length: HORIZON_SLOTS }, (_, i) => [
		horizonStartMs + i * 900_000,
		value(i),
	]);
}

function baseSnapshot(
	tsIso: string,
	priceSlots: Array<[number, number]>,
	pvSlotKwh: Array<[number, number]>,
	overrides: Partial<PlannerKnowledgeSnapshot> = {},
): PlannerKnowledgeSnapshot {
	return {
		id: `id-${tsIso}`,
		tsIso,
		date: "2026-08-30",
		timezone: TZ,
		globalMode: "balanced",
		contributionRevision: 1,
		pvExpectedDayKwh: 18,
		houseLoadExpectedDayKwh: 11,
		batterySocPct: 50,
		batteryCapacityKwh: 10,
		batteryNightReserveKwh: 2,
		priceSlots,
		pvSlotKwh,
		wallboxRequiredEnergyKwh: null,
		wallboxDeadlineIso: null,
		wallboxConnected: null,
		wallboxPresenceDigest: null,
		thermalBufferTempC: null,
		thermalEmptyAtIso: null,
		thermalHeadroomKwh: null,
		climateUnits: [],
		wallboxTargetSocPct: null,
		wallboxMinimumDepartureSocPct: null,
		wallboxEnergyGoalHard: null,
		wallboxManagementMode: null,
		batteryDecision: null,
		...overrides,
	};
}

describe("day_telemetry forecast_horizon (Speicher-Kompaktierung)", () => {
	it("nahezu identische Snapshots (nur aktueller Slot ändert sich) → EINE Basisrevision + winzige Deltas", () => {
		const layout = buildDaySlotLayout("2026-08-30", TZ);
		const day = emptyDayRecord("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
		const priceBase = horizonSlots(layout.startMs, () => 22);
		const pvBase = horizonSlots(layout.startMs, (i) => (i > 24 && i < 96 ? 1.5 : 0));

		/* 50 Replans, jeweils nur der "aktuelle" Slot (Live-PV-Override) unterschiedlich. */
		for (let r = 0; r < 50; r++) {
			const pv = pvBase.map((e) => [e[0], e[1]] as [number, number]);
			pv[30] = [pv[30][0], 1.5 + r * 0.01];
			day.forecastSnapshots.push(
				baseSnapshot(`2026-08-30T08:${String(r).padStart(2, "0")}:00.000Z`, priceBase, pv, {
					id: `snap-${r}`,
					batterySocPct: 40 + r,
				}),
			);
		}

		const compacted = compactForecastSnapshotsForPersist(day);
		assert.equal(compacted.forecastRevisions?.length, 1, "genau eine Basisrevision erwartet");
		for (const snap of compacted.forecastSnapshots) {
			assert.equal(snap.priceSlots.length, 0);
			assert.equal(snap.pvSlotKwh.length, 0);
			assert.ok(snap.forecastRevisionId);
			assert.equal(snap.forecastPriceDelta, undefined, "Preis ändert sich in diesem Szenario nie");
			assert.ok((snap.forecastPvDelta?.length ?? 0) <= 1, "pro Snapshot nur der geänderte Slot als Delta");
		}

		/* day (In-Memory) bleibt unverändert — voller Inhalt, keine Mutation durch compact(). */
		assert.equal(day.forecastSnapshots[0].priceSlots.length, HORIZON_SLOTS);
		assert.equal(day.forecastSnapshots[0].pvSlotKwh.length, HORIZON_SLOTS);
	});

	it("materielle Preisrevision (>15% der Slots anders) → neue Basisrevision statt Delta", () => {
		const layout = buildDaySlotLayout("2026-08-30", TZ);
		const day = emptyDayRecord("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
		const priceA = horizonSlots(layout.startMs, () => 22);
		const pv = horizonSlots(layout.startMs, () => 1);

		day.forecastSnapshots.push(baseSnapshot("t0", priceA, pv, { id: "s0" }));
		day.forecastSnapshots.push(baseSnapshot("t1", priceA, pv, { id: "s1" }));

		/* Echte Preisrevision: neue Tarif-Slots ab jetzt für die zweite Tageshälfte. */
		const priceB = priceA.map((e, i) => (i >= 96 ? ([e[0], 40] as [number, number]) : e));
		day.forecastSnapshots.push(baseSnapshot("t2", priceB, pv, { id: "s2" }));
		day.forecastSnapshots.push(baseSnapshot("t3", priceB, pv, { id: "s3" }));

		const compacted = compactForecastSnapshotsForPersist(day);
		assert.equal(compacted.forecastRevisions?.length, 2, "Preisrevision muss eine zweite Basisrevision erzeugen");
		const revIdOf = (id: string) =>
			compacted.forecastSnapshots.find((s) => s.id === id)?.forecastRevisionId;
		assert.equal(revIdOf("s0"), revIdOf("s1"));
		assert.equal(revIdOf("s2"), revIdOf("s3"));
		assert.notEqual(revIdOf("s0"), revIdOf("s2"));
	});

	it("Rehydrierung liefert exakt die Original-Arrays zurück (verlustfrei)", () => {
		const layout = buildDaySlotLayout("2026-08-30", TZ);
		const day = emptyDayRecord("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
		const priceBase = horizonSlots(layout.startMs, (i) => 20 + (i % 7));
		const pvBase = horizonSlots(layout.startMs, (i) => (i % 5) * 0.3);

		const originals: Array<{ id: string; priceSlots: Array<[number, number]>; pvSlotKwh: Array<[number, number]> }> = [];
		for (let r = 0; r < 30; r++) {
			const price = priceBase.map((e) => [e[0], e[1]] as [number, number]);
			const pv = pvBase.map((e) => [e[0], e[1]] as [number, number]);
			pv[40] = [pv[40][0], Math.round(Math.random() * 100) / 100];
			if (r === 20) {
				/* eine echte Revision mittendrin */
				for (let i = 100; i < 180; i++) price[i] = [price[i][0], price[i][1] + 15];
			}
			day.forecastSnapshots.push(baseSnapshot(`t${r}`, price, pv, { id: `s${r}` }));
			originals.push({ id: `s${r}`, priceSlots: price, pvSlotKwh: pv });
		}

		const compacted = compactForecastSnapshotsForPersist(day);
		/* Simuliert Disk-Roundtrip: JSON-Serialisierung/Deserialisierung. */
		const reloaded = JSON.parse(JSON.stringify(compacted)) as typeof compacted;
		rehydrateForecastRevisions(reloaded);

		for (const orig of originals) {
			const snap = reloaded.forecastSnapshots.find((s) => s.id === orig.id);
			assert.ok(snap, `Snapshot ${orig.id} fehlt nach Rehydrierung`);
			assert.deepEqual(snap!.priceSlots, orig.priceSlots);
			assert.deepEqual(snap!.pvSlotKwh, orig.pvSlotKwh);
		}
	});

	it("Rückwärtskompatibilität: Snapshot ohne forecastRevisionId (Altformat) bleibt bei Rehydrierung unverändert", () => {
		const layout = buildDaySlotLayout("2026-08-30", TZ);
		const day = emptyDayRecord("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
		const price = horizonSlots(layout.startMs, () => 25);
		const pv = horizonSlots(layout.startMs, () => 0.5);
		day.forecastSnapshots.push(baseSnapshot("t0", price, pv, { id: "legacy-1" }));
		day.forecastRevisions = [];

		const before = JSON.parse(JSON.stringify(day.forecastSnapshots[0]));
		rehydrateForecastRevisions(day);
		assert.deepEqual(day.forecastSnapshots[0], before);
	});

	it("leere Preis-/PV-Arrays (kein Forecast bekannt) werden korrekt behandelt", () => {
		const layout = buildDaySlotLayout("2026-08-30", TZ);
		const day = emptyDayRecord("2026-08-30", TZ, layout.startMs, layout.endMs, layout.slotCount);
		day.forecastSnapshots.push(baseSnapshot("t0", [], [], { id: "empty-1" }));
		day.forecastSnapshots.push(baseSnapshot("t1", [], [], { id: "empty-2" }));

		const compacted = compactForecastSnapshotsForPersist(day);
		assert.equal(compacted.forecastRevisions?.length, 1);
		const reloaded = JSON.parse(JSON.stringify(compacted)) as typeof compacted;
		rehydrateForecastRevisions(reloaded);
		for (const snap of reloaded.forecastSnapshots) {
			assert.deepEqual(snap.priceSlots, []);
			assert.deepEqual(snap.pvSlotKwh, []);
		}
	});

	it("Konstanten sind sinnvoll (Dokumentation/Regressionsschutz)", () => {
		assert.ok(FORECAST_HORIZON_DELTA_MAX_RATIO > 0 && FORECAST_HORIZON_DELTA_MAX_RATIO < 1);
		assert.ok(FORECAST_HORIZON_DELTA_MIN_ABS >= 1);
	});
});
