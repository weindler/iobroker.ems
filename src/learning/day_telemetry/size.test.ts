import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addDaysToDateKey } from "../../operator/time.js";
import { readDayTelemetryDay, writeDayTelemetryDay, writeDayTelemetryPersist } from "./persist.js";
import { buildDaySlotLayout, type DaySlotLayout } from "./slots.js";
import { emptyDayRecord, emptyDayTelemetryStore, type PlannerKnowledgeSnapshot } from "./types.js";
import { DOMAIN_QUALITY, TELEMETRY_DOMAIN, encodeDomainQuality } from "./quality_mask.js";

/**
 * Realistische Produktionsannahmen (siehe day_telemetry-Speicheranalyse, Prod-Fund:
 * 166 forecastSnapshots/Tag, ~2,7 MiB — jeder Snapshot trug den vollen Multi-Tage-Horizont
 * inline, obwohl sich zwischen zwei Replans meist nur der aktuelle Live-PV-Slot ändert):
 *
 * - 48h-Horizont @ 15-Min-Slots (192 Einträge) für Preis UND PV — realistischer
 *   Multi-Tage-Forecast, kein verkürzter Test-Horizont.
 * - ~180 materielle Replans/Tag (Größenordnung des real beobachteten Falls: 166).
 * - Zwischen zwei Replans ändert sich fast immer NUR der aktuelle Slot (Live-Override)
 *   plus kleine Diagnose-Felder (SOC, contributionRevision, batteryDecision) — genau das
 *   Muster, das den bestehenden Volltext-Hash-Dedup wirkungslos machte.
 * - Alle ~40 Replans eine ECHTE Forecast-Revision (große Preis-/PV-Änderung über viele
 *   Slots, z. B. Day-Ahead-Preisupdate) — das MUSS weiterhin eine neue vollständige
 *   Basisrevision erzeugen (keine verlustbehaftete Kompression echter Änderungen).
 */
const HORIZON_SLOTS = 192;
const HORIZON_SLOT_MS = 900_000;
const REPLANS_PER_DAY = 180;
const REVISION_EVERY_N_REPLANS = 40;

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

/*
 * WICHTIG: Kurve ist Funktion der ABSOLUTEN Uhrzeit (`tsMs`), nicht des Array-Index `i`.
 * Ein realer Day-Ahead-Preis für z. B. 14:00 ändert sich nicht dadurch, dass der Horizont
 * zwischenzeitlich einen Slot weitergerückt ist (nur eine echte Preisrevision ändert ihn,
 * gesteuert über `revisionSeed`). Würde die Kurve stattdessen vom Index abhängen, wäre bei
 * jeder Horizontverschiebung (Rolling Window) praktisch der GESAMTE Array "anders", weil
 * derselbe Zeitstempel dann in unterschiedlichen Aufrufen unterschiedliche Indizes hätte —
 * das würde die Timestamp-Delta-Kompaktierung genauso wirkungslos wie im Produktionsbefund.
 */
function realisticPriceSlots(horizonStartMs: number, revisionSeed: number): Array<[number, number]> {
	return Array.from({ length: HORIZON_SLOTS }, (_, i) => {
		const tsMs = horizonStartMs + i * HORIZON_SLOT_MS;
		const hourOfDay = (tsMs / 3600_000) % 24;
		const curve = 18 + 9 * Math.sin((hourOfDay / 24) * Math.PI * 2 - 1) + revisionSeed * 6;
		return [tsMs, Math.round(curve * 10) / 10] as [number, number];
	});
}

function realisticPvSlots(horizonStartMs: number, revisionSeed: number): Array<[number, number]> {
	return Array.from({ length: HORIZON_SLOTS }, (_, i) => {
		const tsMs = horizonStartMs + i * HORIZON_SLOT_MS;
		const hourOfDay = (tsMs / 3600_000) % 24;
		const daylight = Math.max(0, Math.sin(((hourOfDay - 6) / 12) * Math.PI));
		const kwh = round4(daylight * (2.4 + revisionSeed * 0.15));
		return [tsMs, kwh] as [number, number];
	});
}

/** Baut einen realistischen Tag: HORIZON_SLOTS-Forecast, REPLANS_PER_DAY Snapshots/Replans. */
function buildRealisticDay(dateKey: string, tz: string) {
	const layout: DaySlotLayout = buildDaySlotLayout(dateKey, tz);
	const day = emptyDayRecord(dateKey, tz, layout.startMs, layout.endMs, layout.slotCount);
	const activeWindowMs = 16 * 3600_000; /* 06:00–22:00 aktive Replan-Phase */
	const stepMs = activeWindowMs / REPLANS_PER_DAY;
	const dayStartActiveMs = layout.startMs + 6 * 3600_000;

	for (let r = 0; r < REPLANS_PER_DAY; r++) {
		const tsMs = dayStartActiveMs + r * stepMs;
		const revisionSeed = Math.floor(r / REVISION_EVERY_N_REPLANS);
		/*
		 * ROLLIERENDER Horizont wie in Produktion: der Preis-/PV-Forecast beginnt beim
		 * aktuellen 15-Min-Slot, nicht am Tagesbeginn — bei jedem Replan rutscht die
		 * gesamte Timeline einen Slot weiter (ältester Slot fällt raus, neuer kommt hinten
		 * dazu). Genau dieses Verhalten hat den ursprünglichen Index-basierten Delta-
		 * Vergleich (`sameTimeline`/`diffSlots` per Array-Position) unwirksam gemacht und
		 * zu ~1,6 MB/Tag trotz Kompaktierung geführt (Produktionsbefund 30.08.2026).
		 */
		const horizonStartMs = Math.floor(tsMs / HORIZON_SLOT_MS) * HORIZON_SLOT_MS;
		const price = realisticPriceSlots(horizonStartMs, revisionSeed);
		const pv = realisticPvSlots(horizonStartMs, revisionSeed);

		/* Live-PV-Override im jeweils aktuellen (=ersten) Slot — der dominante Änderungstreiber. */
		const curIdx = 0;
		pv[curIdx] = [pv[curIdx][0], round4(pv[curIdx][1] + (r % 7) * 0.03)];

		const snap: PlannerKnowledgeSnapshot = {
			id: `snap-${dateKey}-${r}`,
			tsIso: new Date(tsMs).toISOString(),
			date: dateKey,
			timezone: tz,
			globalMode: "balanced",
			contributionRevision: r,
			pvExpectedDayKwh: 18 + revisionSeed,
			houseLoadExpectedDayKwh: 11,
			batterySocPct: 30 + (r % 60),
			batteryCapacityKwh: 10,
			batteryNightReserveKwh: 2,
			priceSlots: price,
			pvSlotKwh: pv,
			wallboxRequiredEnergyKwh: r % 3 === 0 ? 15 : null,
			wallboxDeadlineIso: null,
			wallboxConnected: r % 3 === 0,
			wallboxPresenceDigest: r % 3 === 0 ? "1:a:b" : null,
			thermalBufferTempC: 45 + (r % 10),
			thermalEmptyAtIso: null,
			thermalHeadroomKwh: 3,
			climateUnits: [
				{
					consumerId: "u1",
					sharedPowerGroupId: "outdoor_1",
					mandatory: false,
					mode: "cool",
					hardOffAtIso: new Date(layout.startMs + 20 * 3600_000).toISOString(),
					roomTempC: 24 + (r % 5) * 0.2,
				},
			],
			wallboxTargetSocPct: 80,
			wallboxMinimumDepartureSocPct: 60,
			wallboxEnergyGoalHard: false,
			wallboxManagementMode: "ems_candidate",
			batteryDecision: {
				action: r % 5 === 0 ? "hold" : "discharge_allowed",
				dischargeAllowed: r % 5 !== 0,
				requiredSocAtPvEndPct: 35,
				holdActive: r % 5 === 0,
				reasonCode: r % 5 === 0 ? "battery_hold_active" : "price_and_reserve_ok",
			},
		};
		day.forecastSnapshots.push(snap);

		day.replanEvents.push({
			tsIso: snap.tsIso,
			generation: r + 1,
			planId: `p-${dateKey}-${r}`,
			reasonCodes: r % REVISION_EVERY_N_REPLANS === 0 ? ["replan_price_revision"] : ["replan_pv_forecast_changed"],
			affectedSlotFrom: curIdx,
			affectedSlotTo: layout.slotCount - 1,
			snapshotId: snap.id,
		});

		const slotIdx = Math.min(layout.slotCount - 1, curIdx);
		if (slotIdx >= 0) day.buckets.snapshotIdRef[slotIdx] = snap.id;
	}

	/* Climate segments + Buckets — leichte, realistische Nebendaten (nicht der Größentreiber). */
	for (let c = 0; c < 8; c++) {
		day.climateRunSegments.push({
			startTs: layout.startMs + c * 3600_000,
			endTs: layout.startMs + c * 3600_000 + 1800_000,
			sharedPowerGroupId: "outdoor_1",
			mode: c % 2 === 0 ? "cool" : "dry",
			activeUnitCombination: c % 3 === 0 ? "1+2" : "1",
			energyKwh: 0.4 + c * 0.05,
			runtimeSec: 1800,
			valid: true,
			rejectReason: null,
		});
	}
	day.plannedConsumers.push([
		{ consumerId: "battery", kind: "battery_charge", energyKwh: 0.4 },
		{ consumerId: "outdoor_1", kind: "climate_shared_electric", energyKwh: 0.6 },
	]);
	for (let i = 0; i < layout.slotCount; i++) {
		const b = day.buckets;
		b.pvKwh[i] = i > 24 && i < 72 ? round4(0.15 + (i % 7) * 0.01) : null;
		b.houseTotalKwh[i] = round4(0.08 + (i % 5) * 0.01);
		b.priceCtPerKwh[i] = 18 + (i % 12);
		b.batterySocEndPct[i] = 40 + (i % 30);
		b.plannedConsumersRef[i] = i % 2;
		let mask: number | null = encodeDomainQuality(0, TELEMETRY_DOMAIN.PV, DOMAIN_QUALITY.ok);
		mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.PLANNER, DOMAIN_QUALITY.ok);
		b.qualityMask[i] = mask;
	}

	return { day, layout };
}

describe("day_telemetry realistischer Größentest (Speicher-Kompaktierung)", () => {
	it("17) realistischer Einzeltag — 192-Slot-Horizont × 180 Replans bleibt weit unter 1 MiB", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daytel-realday-"));
		try {
			const { day } = buildRealisticDay("2026-08-30", "Europe/Berlin");
			assert.equal(day.forecastSnapshots.length, REPLANS_PER_DAY);

			await writeDayTelemetryDay(dir, day);
			const st = await fs.stat(path.join(dir, "2026-08-30.json"));
			console.log(
				`day_telemetry realistischer Tag (${REPLANS_PER_DAY} Replans, ${HORIZON_SLOTS}-Slot-Horizont): ${st.size} bytes (${(st.size / 1024).toFixed(1)} KiB)`,
			);
			assert.ok(
				st.size < 512 * 1024,
				`Realistischer Tag zu groß: ${st.size} bytes — Kompaktierung wirkt nicht wie erwartet`,
			);

			/* Punkt-in-Zeit-Rekonstruktion: Roundtrip muss verlustfrei sein (keine Runtime-Rekonstruktion). */
			const reloaded = await readDayTelemetryDay(dir, "2026-08-30");
			assert.ok(reloaded);
			assert.equal(reloaded!.forecastSnapshots.length, REPLANS_PER_DAY);
			for (const idx of [0, 1, 39, 40, 41, 100, REPLANS_PER_DAY - 1]) {
				const before: PlannerKnowledgeSnapshot = day.forecastSnapshots[idx];
				const after: PlannerKnowledgeSnapshot | undefined = reloaded!.forecastSnapshots.find(
					(s) => s.id === before.id,
				);
				assert.ok(after, `Snapshot ${before.id} nach Reload nicht auffindbar`);
				assert.equal(after!.priceSlots.length, HORIZON_SLOTS);
				assert.equal(after!.pvSlotKwh.length, HORIZON_SLOTS);
				assert.deepEqual(after!.priceSlots, before.priceSlots, `priceSlots bei Snapshot ${idx} nicht identisch rekonstruiert`);
				assert.deepEqual(after!.pvSlotKwh, before.pvSlotKwh, `pvSlotKwh bei Snapshot ${idx} nicht identisch rekonstruiert`);
			}

			/* replanEvents bleiben eindeutig einem damals gültigen Snapshot zuordenbar. */
			for (const ev of reloaded!.replanEvents) {
				assert.ok(
					reloaded!.forecastSnapshots.some((s) => s.id === ev.snapshotId),
					`replanEvent ${ev.planId} referenziert unbekannten Snapshot ${ev.snapshotId}`,
				);
			}

			/* Basisrevisionen bleiben klein — Größenordnung der echten Revisionen, keine 180 Kopien. */
			assert.ok(
				(reloaded!.forecastRevisions?.length ?? 0) <= Math.ceil(REPLANS_PER_DAY / REVISION_EVERY_N_REPLANS) + 2,
			);
			assert.ok((reloaded!.forecastRevisions?.length ?? 0) >= 2, "echte Preisrevisionen müssen sichtbar bleiben");
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});

	it("16) 90 Tage realistische Replan-Last — Gesamtgröße skaliert sinnvoll für Retention", async () => {
		const store = emptyDayTelemetryStore();
		const start = "2026-01-01";
		for (let d = 0; d < 90; d++) {
			const dk = addDaysToDateKey(start, d);
			const { day } = buildRealisticDay(dk, "Europe/Berlin");
			store.days[dk] = day;
		}

		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daytel-size90-"));
		try {
			await writeDayTelemetryPersist(dir, store);
			const names = await fs.readdir(dir);
			let total = 0;
			for (const n of names) {
				if (!n.endsWith(".json")) continue;
				total += (await fs.stat(path.join(dir, n))).size;
			}
			const mib = total / (1024 * 1024);
			const perDayKib = total / 90 / 1024;
			console.log(
				`day_telemetry 90 realistische Tage (${REPLANS_PER_DAY} Replans/Tag, ${HORIZON_SLOTS}-Slot-Horizont): ` +
					`${total} bytes (${mib.toFixed(3)} MiB), Ø ${perDayKib.toFixed(1)} KiB/Tag`,
			);
			/*
			 * Referenz: naive Vollduplikation (Ist-Zustand vor der Kompaktierung) würde bei
			 * ~264 KiB/Tag Snapshot-Anteil × 90 Tage bereits > 200 MiB erreichen. Mit
			 * Basisrevision+Delta bleibt die Gesamtgröße für 90 Tage Retention klar im
			 * niedrigen zweistelligen MiB-Bereich.
			 */
			assert.ok(
				mib < 30,
				`90-Tage-Retention mit realistischer Replan-Last zu groß: ${mib.toFixed(3)} MiB`,
			);
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
