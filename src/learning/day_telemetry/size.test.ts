import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { addDaysToDateKey } from "../../operator/time.js";
import { writeDayTelemetryPersist, dayTelemetryPersistPath } from "./persist.js";
import { buildDaySlotLayout } from "./slots.js";
import { emptyDayRecord, emptyDayTelemetryStore, type PlannerKnowledgeSnapshot } from "./types.js";
import { DOMAIN_QUALITY, TELEMETRY_DOMAIN, encodeDomainQuality } from "./quality_mask.js";

function round4(n: number): number {
	return Math.round(n * 10000) / 10000;
}

/**
 * 16) Synthetischer 90-Tage-Größentest — realistische Füllung.
 * Ziel: möglichst < 2 MB.
 */
describe("day_telemetry 90-day size budget", () => {
	it("16) 90 realistische Tage — Dateigröße messen", async () => {
		const store = emptyDayTelemetryStore();
		const start = "2026-01-01";
		const tz = "Europe/Berlin";

		for (let d = 0; d < 90; d++) {
			const dk = addDaysToDateKey(start, d);
			const layout = buildDaySlotLayout(dk, tz);
			const day = emptyDayRecord(dk, tz, layout.startMs, layout.endMs, layout.slotCount);

			/* Snapshots: ~3 pro Tag (Dedup-ähnlich, aber unterschiedlich) */
			for (let s = 0; s < 3; s++) {
				const snap: PlannerKnowledgeSnapshot = {
					id: `snap-${dk}-${s}`,
					tsIso: new Date(layout.startMs + s * 4 * 3600_000).toISOString(),
					date: dk,
					timezone: tz,
					globalMode: "balanced",
					contributionRevision: s,
					pvExpectedDayKwh: 18 + s,
					houseLoadExpectedDayKwh: 11,
					batterySocPct: 40 + s * 5,
					batteryCapacityKwh: 10,
					batteryNightReserveKwh: 2,
					priceSlots: Array.from({ length: 48 }, (_, i) => [
						layout.startMs + i * 1_800_000,
						20 + (i % 10),
					] as [number, number]),
					pvSlotKwh: Array.from({ length: 24 }, (_, i) => [
						layout.startMs + (32 + i) * 900_000,
						0.2 + (i % 5) * 0.05,
					] as [number, number]),
					wallboxRequiredEnergyKwh: 15,
					wallboxDeadlineIso: null,
					wallboxConnected: true,
					wallboxPresenceDigest: "1:a:b",
					thermalBufferTempC: 48,
					thermalEmptyAtIso: null,
					thermalHeadroomKwh: 3,
					climateUnits: [
						{ consumerId: "u1", sharedPowerGroupId: "outdoor_1", mandatory: false, mode: "cool" },
						{ consumerId: "u2", sharedPowerGroupId: "outdoor_1", mandatory: true, mode: "cool" },
					],
				};
				day.forecastSnapshots.push(snap);
			}

			/* Replans */
			for (let r = 0; r < 5; r++) {
				day.replanEvents.push({
					tsIso: new Date(layout.startMs + (r + 1) * 2 * 3600_000).toISOString(),
					generation: r + 1,
					planId: `p-${dk}-${r}`,
					reasonCodes: ["replan_pv_forecast_changed", "replan_price_revision"],
					affectedSlotFrom: r * 8,
					affectedSlotTo: layout.slotCount - 1,
					snapshotId: `snap-${dk}-${r % 3}`,
				});
			}

			/* Climate segments */
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

			day.statusEvents.push({
				tsIso: new Date(layout.startMs + 10 * 3600_000).toISOString(),
				kind: "ev_connected",
				detail: "",
			});

			/* Planned consumers table + refs */
			day.plannedConsumers.push([
				{ consumerId: "battery", kind: "battery_charge", energyKwh: 0.4 },
				{ consumerId: "outdoor_1", kind: "climate_shared_electric", energyKwh: 0.6 },
			]);
			day.plannedConsumers.push([
				{ consumerId: "immersion", kind: "immersion_heater", energyKwh: 0.3 },
			]);

			for (let i = 0; i < layout.slotCount; i++) {
				const b = day.buckets;
				b.pvKwh[i] = i > 24 && i < 72 ? round4(0.15 + (i % 7) * 0.01) : null;
				b.houseTotalKwh[i] = round4(0.08 + (i % 5) * 0.01);
				b.gridImportKwh[i] = i < 20 || i > 80 ? 0.05 : null;
				b.gridExportKwh[i] = i > 40 && i < 60 ? 0.02 : null;
				b.priceCtPerKwh[i] = 18 + (i % 12);
				b.batterySocEndPct[i] = 40 + (i % 30);
				b.batteryChargedKwh[i] = i % 4 === 0 ? 0.1 : null;
				b.batteryDischargedKwh[i] = i % 5 === 0 ? 0.05 : null;
				b.evChargedKwh[i] = i > 50 && i < 60 ? 0.2 : null;
				b.evSocEndPct[i] = i > 50 && i < 60 ? 60 : null;
				b.immersionKwh[i] = i > 30 && i < 36 ? 0.25 : null;
				b.immersionRuntimeSec[i] = i > 30 && i < 36 ? 900 : null;
				b.boilerTempEndC[i] = i % 4 === 0 ? round4(50 + (i % 10) * 0.1) : null;
				b.climateKwh[i] = i > 40 && i < 70 ? 0.12 : null;
				b.climateElecSharedKwh[i] = i > 40 && i < 70 ? 0.12 : null;
				b.otherMeasuredConsumersKwh[i] = 0.03;
				b.plannedConsumersRef[i] = i % 2;
				b.snapshotIdRef[i] = `snap-${dk}-${i % 3}`;
				let mask = 0;
				mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.PV, DOMAIN_QUALITY.ok);
				mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.HOUSE, DOMAIN_QUALITY.ok);
				mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.GRID, DOMAIN_QUALITY.ok);
				mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.BATTERY, DOMAIN_QUALITY.ok);
				mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.PRICE, DOMAIN_QUALITY.ok);
				mask = encodeDomainQuality(mask, TELEMETRY_DOMAIN.PLANNER, DOMAIN_QUALITY.ok);
				b.qualityMask[i] = mask;
			}

			store.days[dk] = day;
		}

		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "daytel-size-"));
		try {
			await writeDayTelemetryPersist(dir, store);
			const st = await fs.stat(dayTelemetryPersistPath(dir));
			const mb = st.size / (1024 * 1024);
			console.log(
				`day_telemetry 90-day synthetic size: ${st.size} bytes (${mb.toFixed(3)} MiB)`,
			);
			/* Hartes Budget: Warnung wenn > 2 MiB, Test failt erst > 4 MiB (Kompaktierungs-Spielraum) */
			assert.ok(
				st.size < 4 * 1024 * 1024,
				`90-Tage-Datei zu groß: ${st.size} bytes (${mb.toFixed(3)} MiB)`,
			);
			if (st.size >= 2 * 1024 * 1024) {
				console.warn(
					`WARN: 90-Tage-Größe ${mb.toFixed(3)} MiB ≥ 2 MiB Ziel — Schema weiter verdichten`,
				);
			}
		} finally {
			await fs.rm(dir, { recursive: true, force: true });
		}
	});
});
