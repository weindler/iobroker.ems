import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	aggregatePowerPointsByHour,
	normalizeBatteryPowerW,
	resolveEffectivePowerInvert,
} from "./history";
import { computePowerStats } from "./math";
import { MS_PER_HOUR } from "./constants";

describe("battery runtime power history", () => {
	it("auto-detects Sonnen-like sign convention", () => {
		const rows = [
			{ val: 250 },
			{ val: 260 },
			{ val: 240 },
			{ val: -1200 },
			{ val: -800 },
		];
		const r = resolveEffectivePowerInvert(false, rows);
		assert.equal(r.invert, true);
		assert.equal(r.autoDetected, true);
	});

	it("keeps hourly charge peak when hour ends with standby discharge", () => {
		const base = Date.parse("2026-06-30T12:00:00Z");
		const rows = [
			{ ts: base + 5 * 60_000, val: -3000 },
			{ ts: base + 55 * 60_000, val: 80 },
		];
		const legacyLastWins = aggregatePowerPointsByHour(rows, true);
		const stats = computePowerStats(legacyLastWins.points);
		assert.equal(stats.maxChargePowerW, 3000);
		assert.equal(stats.avgChargePowerW, 3000);
		assert.equal(legacyLastWins.meta.rawChargeSamples, 1);
		assert.equal(legacyLastWins.meta.rawDischargeSamples, 1);
		assert.equal(legacyLastWins.meta.hourlyChargePoints, 1);
		assert.equal(legacyLastWins.meta.hourlyDischargePoints, 1);
	});

	it("last-value hourly dedup would drop charge without max-per-hour aggregation", () => {
		const base = Date.parse("2026-06-30T12:00:00Z");
		const bucket = Math.floor(base / MS_PER_HOUR);
		let last: number | null = null;
		for (const row of [
			{ ts: base + 5 * 60_000, val: -3000 },
			{ ts: base + 55 * 60_000, val: 80 },
		]) {
			const w = normalizeBatteryPowerW(row.val, true);
			if (w !== null) last = w;
		}
		assert.equal(last, -80);
		const stats = computePowerStats(
			last !== null ? [{ ts: base, powerW: last }] : [],
		);
		assert.equal(stats.maxChargePowerW, null);
		assert.equal(stats.maxDischargePowerW, 80);
		assert.notEqual(bucket, 0);
	});
});
