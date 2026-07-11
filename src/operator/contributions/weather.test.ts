import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildWeatherContribution } from "./weather";

describe("weather contribution", () => {
	const now = new Date("2026-07-11T10:00:00.000Z");

	it("provides context without energy roles", () => {
		const c = buildWeatherContribution({
			now,
			learningStatus: "ready",
			learningHealth: "ok",
			confidencePct: 88,
			lastUpdate: now.toISOString(),
			forecastSource: "brightsky",
			actualSource: "brightsky",
			outdoorTempC: 24.5,
			cloudPct: 30,
			hourlyPoints: [],
			todayMinTempC: 18,
			todayMaxTempC: 26,
			tomorrowMinTempC: null,
			tomorrowMaxTempC: null,
			forecastHorizonStart: now.toISOString(),
			forecastHorizonEnd: "2026-07-12T21:59:59.999Z",
		});
		assert.equal(c.contributor.id, "weather_forecast");
		assert.deepEqual(c.roles, ["context"]);
		assert.equal(c.details.contextOnly, true);
		assert.notDeepEqual(c.roles, ["supply"]);
	});

	it("allows missing partial values", () => {
		const c = buildWeatherContribution({
			now,
			learningStatus: "ready",
			learningHealth: "ok",
			confidencePct: 50,
			lastUpdate: now.toISOString(),
			forecastSource: "brightsky",
			actualSource: null,
			outdoorTempC: 20,
			cloudPct: null,
			hourlyPoints: [],
			todayMinTempC: null,
			todayMaxTempC: 20,
			tomorrowMinTempC: null,
			tomorrowMaxTempC: null,
			forecastHorizonStart: now.toISOString(),
			forecastHorizonEnd: null,
		});
		assert.equal(c.enabled, true);
		assert.equal(c.details.cloudPct, null);
	});

	it("marks missing weather as missing", () => {
		const c = buildWeatherContribution({
			now,
			learningStatus: "not_initialized",
			learningHealth: "error",
			confidencePct: null,
			lastUpdate: null,
			forecastSource: null,
			actualSource: null,
			outdoorTempC: null,
			cloudPct: null,
			hourlyPoints: [],
			todayMinTempC: null,
			todayMaxTempC: null,
			tomorrowMinTempC: null,
			tomorrowMaxTempC: null,
			forecastHorizonStart: null,
			forecastHorizonEnd: null,
		});
		assert.equal(c.enabled, false);
		assert.equal(c.quality.status, "missing");
	});
});
