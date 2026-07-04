import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	computeTickDeltaSec,
	emptyConsumerEntry,
	ingestConsumerStatsTick,
	resolveActivePowerW,
	snapshotFromEntry,
} from "./buffer";
import { immersionConsumerStatsFromConfig } from "./config";
import { localDateKey } from "../energy_daily_rollup/day";

describe("consumer stats", () => {
	it("accumulates runtime and energy while active", () => {
		const base = Date.parse("2026-07-04T10:00:00");
		let entry = emptyConsumerEntry("immersion_heater", base);
		const config = immersionConsumerStatsFromConfig({});
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "immersion_heater",
				nowMs: base,
				active: true,
				measuredPowerW: 1700,
				commandedPowerW: 1700,
			},
			config,
		);
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "immersion_heater",
				nowMs: base + 5000,
				active: true,
				measuredPowerW: 1700,
				commandedPowerW: 1700,
			},
			config,
		);
		assert.equal(entry.totalRuntimeSec, 5);
		assert.equal(entry.todayRuntimeSec, 5);
		assert.equal(entry.totalEnergyKwh, 0.002);
	});

	it("finalizes session when device turns off", () => {
		const base = Date.parse("2026-07-04T10:00:00");
		let entry = emptyConsumerEntry("immersion_heater", base);
		const config = immersionConsumerStatsFromConfig({});
		entry = ingestConsumerStatsTick(
			entry,
			{ consumerKey: "immersion_heater", nowMs: base, active: true, measuredPowerW: 1000, commandedPowerW: 1000 },
			config,
		);
		entry = ingestConsumerStatsTick(
			entry,
			{
				consumerKey: "immersion_heater",
				nowMs: base + 10_000,
				active: false,
				measuredPowerW: 0,
				commandedPowerW: 0,
			},
			config,
		);
		assert.equal(entry.lastSessionRuntimeSec, 10);
		assert.equal(entry.sessionRuntimeSec, 0);
		assert.equal(entry.wasActive, false);
	});

	it("applies admin offsets in snapshot totals", () => {
		const base = Date.parse("2026-07-04T10:00:00");
		const entry = emptyConsumerEntry("immersion_heater", base);
		entry.totalRuntimeSec = 3600;
		entry.totalEnergyKwh = 1.5;
		const config = immersionConsumerStatsFromConfig({
			ih_stats_runtime_offset_h: 2,
			ih_stats_energy_offset_kwh: 10,
		});
		const snap = snapshotFromEntry(entry, config, base);
		assert.equal(snap.totalRuntimeSec, 3600 + 7200);
		assert.equal(snap.totalEnergyKwh, 11.5);
	});

	it("resets today counters on day rollover", () => {
		const day1 = Date.parse("2026-07-04T23:59:58");
		const day2 = Date.parse("2026-07-05T00:00:03");
		let entry = emptyConsumerEntry("immersion_heater", day1);
		const config = immersionConsumerStatsFromConfig({});
		entry.totalRuntimeSec = 100;
		entry.todayRuntimeSec = 100;
		entry.todayDateKey = localDateKey(new Date(day1));
		entry.wasActive = true;
		entry.lastTickMs = day1;
		entry = ingestConsumerStatsTick(
			entry,
			{ consumerKey: "immersion_heater", nowMs: day2, active: true, measuredPowerW: 1000, commandedPowerW: 1000 },
			config,
		);
		assert.equal(entry.todayDateKey, localDateKey(new Date(day2)));
		assert.equal(entry.todayRuntimeSec, 5);
		assert.equal(entry.totalRuntimeSec, 105);
		assert.ok(entry.days["2026-07-04"]);
	});

	it("prefers measured power over commanded power", () => {
		const power = resolveActivePowerW({
			measuredPowerW: 1744,
			commandedPowerW: 1700,
			powerOnThresholdW: 50,
		});
		assert.equal(power, 1744);
	});

	it("caps tick delta to avoid restart spikes", () => {
		assert.equal(computeTickDeltaSec(100_000, 0), 0);
		assert.equal(computeTickDeltaSec(100_000, 50_000), 30);
	});
});
