import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { describe, it } from "node:test";
import {
	computeWeatherLearning,
	confidenceFromValidHours,
	healthFromValidHours,
	isValidMetricValue,
	metricBias,
} from "./math";
import { dayResultToPersist, writeWeatherDayPersist } from "./persist";
import type { WeatherDayResult } from "./types";

function day(overrides: Partial<WeatherDayResult> & { dayOffset: number }): WeatherDayResult {
	return {
		dateKey: `2026-06-${String(20 - overrides.dayOffset).padStart(2, "0")}`,
		validHours: 20,
		metrics: {
			temp: { bias: 1.2, validHours: 20 },
			cloud: { bias: -8.5, validHours: 20 },
		},
		missingForecast: [],
		missingActual: [],
		confidence: "high",
		health: "ok",
		...overrides,
	};
}

describe("weather learning math", () => {
	it("treats missing as not zero", () => {
		assert.equal(isValidMetricValue("temp", null), false);
		assert.equal(isValidMetricValue("cloud", Number.NaN), false);
		assert.equal(isValidMetricValue("rain", undefined as unknown as number), false);
		assert.equal(isValidMetricValue("temp", 0), true);
		assert.equal(isValidMetricValue("cloud", 150), false);
	});

	it("compares only valid forecast/actual pairs via metric bias", () => {
		assert.equal(metricBias(22, 20), 2);
		assert.equal(metricBias(0, 0), 0);
	});

	it("maps health to valid hour counts", () => {
		assert.equal(healthFromValidHours(21), "ok");
		assert.equal(healthFromValidHours(10), "warning");
		assert.equal(healthFromValidHours(3), "error");
	});

	it("maps confidence to valid hour counts", () => {
		assert.equal(confidenceFromValidHours(20), "high");
		assert.equal(confidenceFromValidHours(14), "medium");
		assert.equal(confidenceFromValidHours(8), "low");
		assert.equal(confidenceFromValidHours(2), "none");
	});

	it("aggregates 7d sample days and yesterday summary", () => {
		const days = [0, 1, 2, 3, 4, 5, 6].map((offset) =>
			day({ dayOffset: offset, validHours: 20 }),
		);
		const yesterday = days[1];
		const result = computeWeatherLearning(
			days,
			{ temp: { forecastStateId: "f", actualStateId: "a" }, cloud: { forecastStateId: "f2", actualStateId: "a2" } },
			yesterday,
			"brightsky",
			"weather_station",
		);
		assert.equal(result.status, "ready");
		assert.equal(result.sampleDays7d, 7);
		assert.equal(result.tempBiasC, 1.2);
		assert.equal(result.validFields.join(","), "temp,cloud");
		assert.ok(result.summaryYesterday.includes("Gestern"));
	});

	it("reports insufficient_data without valid days", () => {
		const days = [day({ dayOffset: 0, validHours: 2, metrics: {} })];
		const result = computeWeatherLearning(days, { temp: { forecastStateId: "f", actualStateId: "a" } }, null, "f", "a");
		assert.equal(result.status, "insufficient_data");
		assert.equal(result.confidence, "none");
	});

	it("writes persistence file", async () => {
		const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-weather-"));
		const payload = dayResultToPersist(
			day({ dayOffset: 1 }),
			"brightsky",
			"weather_station",
		);
		await writeWeatherDayPersist(tmp, payload);
		const raw = await fs.readFile(path.join(tmp, `${payload.date}.json`), "utf8");
		const parsed = JSON.parse(raw);
		assert.equal(parsed.module, "learning.weather.v1");
		assert.equal(parsed.valid_hours, 20);
		assert.equal(parsed.metrics.temp_bias_c, 1.2);
		await fs.rm(tmp, { recursive: true, force: true });
	});
});
