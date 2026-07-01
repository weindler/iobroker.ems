import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	computePvBias,
	confidencePct,
	correctForecastKwh,
	dayBiasPct,
	meanBiasPct,
} from "./math";
import type { PvBiasDayPair } from "./types";

describe("pv_bias math", () => {
	it("ignores missing forecast (null pair)", () => {
		const b = dayBiasPct(24, 0);
		assert.equal(b, null);
	});

	it("ignores forecast = 0 (no division by zero)", () => {
		const b = dayBiasPct(10, 0);
		assert.equal(b, null);
		const pairs: PvBiasDayPair[] = [{ dayOffset: 0, actualKwh: 10, forecastKwh: 0 }];
		const m = meanBiasPct(pairs);
		assert.equal(m.sampleDays, 0);
		assert.equal(m.biasPct, null);
	});

	it("negative bias when forecast too high", () => {
		const b = dayBiasPct(24, 30);
		assert.ok(b !== null && b < 0);
		assert.equal(Math.round(b!), -20);
	});

	it("positive bias when forecast too low", () => {
		const b = dayBiasPct(36, 30);
		assert.ok(b !== null && b > 0);
		assert.equal(Math.round(b!), 20);
	});

	it("skips days with missing actual in window", () => {
		const pairs: PvBiasDayPair[] = [
			{ dayOffset: 1, actualKwh: 20, forecastKwh: 25 },
			{ dayOffset: 2, actualKwh: 22, forecastKwh: 20 },
		];
		const m = meanBiasPct(pairs);
		assert.equal(m.sampleDays, 2);
	});

	it("low confidence with little history", () => {
		const pairs: PvBiasDayPair[] = [{ dayOffset: 1, actualKwh: 10, forecastKwh: 12 }];
		const r = computePvBias(pairs, 30, 35);
		assert.ok(r.confidencePct < 40);
		assert.equal(r.status, "insufficient_data");
	});

	it("corrects forecast with bias", () => {
		const corrected = correctForecastKwh(30, -20);
		assert.equal(corrected, 24);
	});

	it("tomorrow correction prefers 7d bias over 30d", () => {
		const pairs: PvBiasDayPair[] = [];
		for (let i = 1; i <= 7; i++) {
			pairs.push({ dayOffset: i, actualKwh: 24, forecastKwh: 30 });
		}
		for (let i = 8; i < 30; i++) {
			pairs.push({ dayOffset: i, actualKwh: 30, forecastKwh: 30 });
		}
		const r = computePvBias(pairs, null, 100);
		assert.equal(r.bias7dPct !== null && Math.round(r.bias7dPct), -20);
		assert.equal(r.correctedTomorrowKwh, 80);
	});

	it("corrected today uses 7d bias, not poisoned intraday today pair", () => {
		const pairs: PvBiasDayPair[] = [
			{ dayOffset: 0, actualKwh: 44, forecastKwh: 13.2 },
			{ dayOffset: 1, actualKwh: 24, forecastKwh: 30 },
			{ dayOffset: 2, actualKwh: 24, forecastKwh: 30 },
			{ dayOffset: 3, actualKwh: 24, forecastKwh: 30 },
		];
		const r = computePvBias(pairs, 13.2, null);
		assert.equal(r.biasTodayPct !== null && Math.round(r.biasTodayPct!), 233);
		assert.equal(r.bias7dPct !== null && Math.round(r.bias7dPct!), -20);
		assert.equal(r.correctedTodayKwh, 10.56);
	});

	it("excludes incomplete today from 7d sample", () => {
		const pairs: PvBiasDayPair[] = [{ dayOffset: 0, actualKwh: 5, forecastKwh: 20 }];
		const r = computePvBias(pairs, 20, 25);
		assert.equal(r.sampleDays7d, 0);
		assert.equal(r.bias7dPct, null);
	});

	it("confidence scales with sample days", () => {
		assert.equal(confidencePct(0, 0, null), 0);
		assert.ok(confidencePct(2, 2, 40) < confidencePct(20, 7, 10));
	});
});
