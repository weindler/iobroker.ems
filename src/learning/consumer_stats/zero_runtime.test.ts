import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { emptyConsumerEntry, ingestConsumerStatsTick, dayRecordFromEntry } from "./buffer";
import { acUnitStatsFromConfig } from "./config";
import { collectRecentDayMetrics, resolveConsumerEffectivePowerW } from "./learned_power";

const config = acUnitStatsFromConfig({ ac_u1_enabled: true, ac_u1_stats_enabled: true }, 1);

describe("consumer stats — Climate 0-Laufzeit-Tage", () => {
	it("echter 0-Laufzeit-Tag bei verfügbarem Modus und Raumdaten wird persistiert", () => {
		const base = Date.parse("2026-08-30T10:00:00");
		let entry = emptyConsumerEntry("air_conditioning.unit_1", base);
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "air_conditioning.unit_1",
				nowMs: base + 5_000,
				deviceActive: false,
				countable: false,
				measuredPowerW: null,
				commandedPowerW: 0,
				zeroRuntimeEvaluable: true,
				modesAvailable: ["cooling"],
				roomDataOk: true,
			},
			config,
		);
		const rec = dayRecordFromEntry(entry);
		assert.ok(rec);
		assert.equal(rec!.runtimeSec, 0);
		assert.equal(rec!.energyKwh, 0);
		assert.equal(rec!.zeroRuntimeEvaluable, true);
		assert.deepEqual(rec!.modesAvailable, ["cooling"]);
	});

	it("deaktivierter Modus / Unit erzeugt kein künstliches 0-Bedarf-Sample", () => {
		const base = Date.parse("2026-08-30T10:00:00");
		let entry = emptyConsumerEntry("air_conditioning.unit_1", base);
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "air_conditioning.unit_1",
				nowMs: base + 5_000,
				deviceActive: false,
				countable: false,
				measuredPowerW: null,
				commandedPowerW: 0,
				zeroRuntimeEvaluable: false,
				roomDataOk: false,
			},
			config,
		);
		assert.equal(dayRecordFromEntry(entry), null);
	});

	it("unzureichende Raumdaten erzeugen kein 0-Sample", () => {
		const base = Date.parse("2026-08-30T10:00:00");
		let entry = emptyConsumerEntry("air_conditioning.unit_1", base);
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "air_conditioning.unit_1",
				nowMs: base + 5_000,
				deviceActive: false,
				countable: false,
				measuredPowerW: null,
				commandedPowerW: 0,
				zeroRuntimeEvaluable: true,
				modesAvailable: ["cooling"],
				roomDataOk: false,
			},
			config,
		);
		assert.equal(dayRecordFromEntry(entry), null);
	});

	it("0-Runtime-Tage beeinflussen Power-Learning und medianRuntime nicht", () => {
		const now = Date.parse("2026-08-30T12:00:00");
		const entry = emptyConsumerEntry("air_conditioning.unit_1", now);
		for (let i = 0; i < 5; i++) {
			const key = `2026-08-${String(20 + i).padStart(2, "0")}`;
			entry.days[key] = {
				dateKey: key,
				runtimeSec: 7200,
				energyKwh: 1.44,
				lastTickMs: now,
			};
		}
		entry.days["2026-08-29"] = {
			dateKey: "2026-08-29",
			runtimeSec: 0,
			energyKwh: 0,
			lastTickMs: now,
			zeroRuntimeEvaluable: true,
			modesAvailable: ["cooling"],
			roomDataOk: true,
		};
		const metrics = collectRecentDayMetrics(entry, now);
		assert.equal(metrics.runtimeSecs.length, 5);
		assert.equal(metrics.powerWs.length, 5);
		const learned = resolveConsumerEffectivePowerW(entry, 700, now);
		assert.equal(learned.source, "learned");
		assert.equal(learned.powerW, 720);
		assert.equal(learned.sampleDays, 5);
	});

	it("Rollover persistiert 0-Tag und setzt Tagesflags zurück", () => {
		const day1 = Date.parse("2026-08-30T23:59:50");
		const day2 = Date.parse("2026-08-31T00:00:10");
		let entry = emptyConsumerEntry("air_conditioning.unit_1", day1);
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "air_conditioning.unit_1",
				nowMs: day1,
				deviceActive: false,
				countable: false,
				measuredPowerW: null,
				commandedPowerW: 0,
				zeroRuntimeEvaluable: true,
				modesAvailable: ["cooling", "dehumidify"],
				roomDataOk: true,
			},
			config,
		);
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "air_conditioning.unit_1",
				nowMs: day2,
				deviceActive: false,
				countable: false,
				measuredPowerW: null,
				commandedPowerW: 0,
			},
			config,
		);
		assert.ok(entry.days["2026-08-30"]);
		assert.equal(entry.days["2026-08-30"].runtimeSec, 0);
		assert.equal(entry.days["2026-08-30"].zeroRuntimeEvaluable, true);
		assert.equal(entry.todayZeroRuntimeEvaluable, false);
		assert.equal(entry.todayRoomDataOk, false);
	});
});
