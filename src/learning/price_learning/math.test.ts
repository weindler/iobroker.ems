import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import { isValidPriceValue, toEurPerKwh } from "./history";
import {
	buildHourPatterns,
	computeConfidence,
	computePriceLearning,
	healthFromMetrics,
	volatilityCoefficient,
} from "./math";
import { writePriceLearningPersist } from "./persist";
import type { PriceDaySummary } from "./types";
import type { PriceSample } from "./history";

function sample(hourOfDay: number, dayOffset: number, priceEur: number): PriceSample {
	const d = new Date();
	d.setHours(hourOfDay, 0, 0, 0);
	d.setDate(d.getDate() - dayOffset);
	const ts = d.getTime();
	return {
		ts,
		priceEur,
		hourBucket: ts,
		dateKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
		hourOfDay,
	};
}

function daySummary(dayOffset: number, validHours: number, avg: number | null): PriceDaySummary {
	const d = new Date();
	d.setDate(d.getDate() - dayOffset);
	return {
		dateKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
		dayOffset,
		validHours,
		avgPriceEur: avg,
	};
}

describe("price learning math", () => {
	it("treats missing as not zero", () => {
		assert.equal(isValidPriceValue(null, "eur_per_kwh"), false);
		assert.equal(isValidPriceValue(Number.NaN, "ct_per_kwh"), false);
		assert.equal(isValidPriceValue(0, "eur_per_kwh"), true);
		assert.equal(isValidPriceValue(0, "ct_per_kwh"), true);
		assert.equal(isValidPriceValue(25, "ct_per_kwh"), true);
		assert.equal(isValidPriceValue(600, "ct_per_kwh"), false);
	});

	it("converts ct/kWh to EUR/kWh", () => {
		assert.equal(toEurPerKwh(24.5, "ct_per_kwh"), 0.245);
		assert.equal(toEurPerKwh(0.245, "eur_per_kwh"), 0.245);
	});

	it("derives cheap and expensive hours from data", () => {
		const samples = [
			...Array.from({ length: 5 }, () => sample(2, 1, 0.12)),
			...Array.from({ length: 5 }, () => sample(3, 1, 0.13)),
			...Array.from({ length: 5 }, () => sample(18, 1, 0.42)),
			...Array.from({ length: 5 }, () => sample(19, 1, 0.45)),
		];
		const patterns = buildHourPatterns(samples);
		assert.ok(Object.keys(patterns.cheapHours).includes("2"));
		assert.ok(Object.keys(patterns.expensiveHours).includes("19"));
	});

	it("computes averages volatility and confidence", () => {
		const days = Array.from({ length: 30 }, (_, i) => daySummary(i, 20, 0.2 + (i % 5) * 0.01));
		const samples = days.flatMap((d) =>
			Array.from({ length: 20 }, (_, h) => sample(h, d.dayOffset, d.avgPriceEur ?? 0.2)),
		);
		const result = computePriceLearning(samples, days, 30, "ems_live_price");
		assert.equal(result.status, "ready");
		assert.ok(result.avgPrice7d !== null);
		assert.ok(result.avgPrice30d !== null);
		assert.ok(result.volatility30d !== null);
		assert.ok(result.confidence >= 50);
		assert.equal(result.health, "ok");
	});

	it("reports insufficient_data without valid days", () => {
		const days = [daySummary(0, 2, 0.2)];
		const result = computePriceLearning([], days, 90, "ems_live_price");
		assert.equal(result.status, "insufficient_data");
		assert.equal(result.sampleDays, 0);
	});

	it("reduces confidence with high volatility", () => {
		const lowVol = computeConfidence({
			sampleDays: 60,
			lookbackDays: 90,
			coveragePct: 90,
			volatility30d: 0.05,
		});
		const highVol = computeConfidence({
			sampleDays: 60,
			lookbackDays: 90,
			coveragePct: 90,
			volatility30d: 0.6,
		});
		assert.ok(lowVol > highVol);
	});

	it("maps health from sample coverage", () => {
		assert.equal(healthFromMetrics(40, 85), "ok");
		assert.equal(healthFromMetrics(10, 60), "warning");
		assert.equal(healthFromMetrics(2, 10), "degraded");
	});

	it("writes persist file", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "price-learning-"));
		const result = computePriceLearning(
			[sample(2, 1, 0.2)],
			[daySummary(1, 20, 0.2)],
			90,
			"ems_live_price",
		);
		await writePriceLearningPersist(dir, result, "2026-06-20T12:00:00.000Z");
		const raw = await fs.readFile(path.join(dir, "price_learning_v1.json"), "utf8");
		const parsed = JSON.parse(raw) as { module: string; avg_price_7d: number | null };
		assert.equal(parsed.module, "learning.price_learning.v1");
		assert.ok("health" in parsed);
	});
});
