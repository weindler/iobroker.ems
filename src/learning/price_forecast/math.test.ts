import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	accuracyFromAvgErrorCt,
	computePriceForecastLearning,
	stabilityFromDailyAccuracy,
} from "./math";
import { writeForecastFreezeFile, writePriceForecastPersist } from "./persist";
import { parseTibberPriceJsonToHourlySlots } from "./tibber_parse";
import type { MatchedHourPair } from "./types";

function slotJson(targetDate: string, hour: number, totalEur: number): string {
	const d = new Date(`${targetDate}T${String(hour).padStart(2, "0")}:00:00`);
	return JSON.stringify([{ total: totalEur, startsAt: d.toISOString() }]);
}

function pair(targetDate: string, hour: number, forecastCt: number, actualCt: number): MatchedHourPair {
	const hourStartMs = new Date(`${targetDate}T${String(hour).padStart(2, "0")}:00:00`).getTime();
	return {
		targetDate,
		hourStartMs,
		forecastCt,
		actualCt,
		absErrorCt: Math.abs(forecastCt - actualCt),
	};
}

describe("price forecast learning", () => {
	it("parses Tibber JSON to hourly ct/kWh slots", () => {
		const target = "2026-06-21";
		const slots = parseTibberPriceJsonToHourlySlots(slotJson(target, 18, 0.25), target);
		assert.equal(slots.length, 1);
		assert.equal(slots[0].forecastCtPerKwh, 25);
	});

	it("computes absolute error accuracy", () => {
		assert.equal(accuracyFromAvgErrorCt(2), 80);
		assert.equal(accuracyFromAvgErrorCt(0), 100);
		assert.equal(accuracyFromAvgErrorCt(12), 0);
	});

	it("classifies stability from daily accuracy spread", () => {
		assert.equal(stabilityFromDailyAccuracy([90, 91, 89]), "stable");
		assert.equal(stabilityFromDailyAccuracy([90, 70, 50]), "volatile");
	});

	it("aggregates matched pairs into learning result", () => {
		const now = new Date("2026-06-20T20:00:00");
		const pairs: MatchedHourPair[] = [];
		for (let d = 0; d < 10; d++) {
			const date = `2026-06-${String(20 - d).padStart(2, "0")}`;
			for (let h = 0; h < 8; h++) {
				pairs.push(pair(date, h, 25, 27));
			}
		}
		const result = computePriceForecastLearning(pairs, 90, "tibberlink", "tibberlink", now);
		assert.equal(result.avgErrorCt7d, 2);
		assert.equal(result.forecastAccuracy7d, 80);
		assert.ok(result.sampleDays >= 1);
	});

	it("writes freeze and persist files", async () => {
		const dir = await fs.mkdtemp(path.join(os.tmpdir(), "price-forecast-"));
		await writeForecastFreezeFile(dir, {
			module: "learning.price_forecast.v1",
			frozen_at: "2026-06-20T14:00:00.000Z",
			freeze_date: "2026-06-20",
			target_date: "2026-06-21",
			forecast_source: "tibber",
			slots: [{ hourStartMs: Date.parse("2026-06-21T18:00:00"), forecastCtPerKwh: 25 }],
		});
		const raw = await fs.readFile(path.join(dir, "freeze", "2026-06-21.json"), "utf8");
		assert.ok(raw.includes("forecastCtPerKwh"));

		const result = computePriceForecastLearning([], 90, "tibber", "tibber", new Date());
		await writePriceForecastPersist(dir, result, "2026-06-20T15:00:00.000Z");
		const persist = JSON.parse(
			await fs.readFile(path.join(dir, "price_forecast_learning_v1.json"), "utf8"),
		) as { module: string };
		assert.equal(persist.module, "learning.price_forecast.v1");
	});
});
