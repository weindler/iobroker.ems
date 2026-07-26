import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectContributions, parseHouseLoadForecastHorizonJson, type ContributionsReadHost } from "./read";

const PV_SHAPE_CONFIG = {
	pv_shape_enabled: true,
	pv_shape_brightsky_hourly_prefix: "brightsky.0.hourly",
	pv_shape_kwp_state_1: "pvforecast.0.plants.roofA.power.installed",
	pv_shape_kwp_state_2: "",
	intent_timezone: "Europe/Berlin",
};

function buildHost(systemConfigCommon: Record<string, unknown> | null): ContributionsReadHost {
	return {
		config: PV_SHAPE_CONFIG,
		getStateAsync: async (id: string) => {
			if (id === "learning.pv_bias.corrected_today_kwh") return { val: 45.6 } as ioBroker.State;
			if (id === "learning.pv_bias.status") return { val: "ready" } as ioBroker.State;
			return null;
		},
		setObjectNotExistsAsync: async () => undefined,
		setStateAsync: async () => undefined,
		getForeignStateAsync: async (id: string) => {
			if (id === "pvforecast.0.plants.roofA.power.installed") return { val: 5 } as ioBroker.State;
			return null;
		},
		getForeignObjectAsync: async (id: string) => {
			if (id !== "system.config") return null;
			if (!systemConfigCommon) return null;
			return { common: systemConfigCommon } as unknown as ioBroker.Object;
		},
	};
}

describe("collectContributions — PV shape system location parsing", () => {
	const now = new Date("2026-07-25T12:40:00.000Z");

	it("activates the weather-shaped PV curve for numeric lat/lon", async () => {
		const host = buildHost({ latitude: 49.177197, longitude: 12.486605 });
		const { contributions } = await collectContributions(host, now);
		const pv = contributions.find((c) => c.contributionId === "pv_forecast.supply");
		assert.equal(pv?.details.slotResolution, "weather_shaped_15min");
		assert.ok((pv?.slots.length ?? 0) > 0);
	});

	it("still activates when lat/lon are comma-decimal strings (e.g. Float-Teiler = Komma)", async () => {
		const host = buildHost({ latitude: "49,177197", longitude: "12,486605" });
		const { contributions } = await collectContributions(host, now);
		const pv = contributions.find((c) => c.contributionId === "pv_forecast.supply");
		assert.equal(pv?.details.slotResolution, "weather_shaped_15min");
		assert.ok((pv?.slots.length ?? 0) > 0);
	});

	it("stays daily_only without a usable system location (fail-closed, no invented curve)", async () => {
		const host = buildHost(null);
		const { contributions } = await collectContributions(host, now);
		const pv = contributions.find((c) => c.contributionId === "pv_forecast.supply");
		assert.equal(pv?.details.slotResolution, "daily_only");
		assert.equal(pv?.slots.length, 0);
	});
});

describe("parseHouseLoadForecastHorizonJson", () => {
	it("returns null for missing/invalid input (no fabricated horizon)", () => {
		assert.equal(parseHouseLoadForecastHorizonJson(null), null);
		assert.equal(parseHouseLoadForecastHorizonJson("not json"), null);
		assert.equal(parseHouseLoadForecastHorizonJson("{}"), null);
		assert.equal(parseHouseLoadForecastHorizonJson("[]"), null);
	});

	it("parses a valid array of day forecasts", () => {
		const raw = JSON.stringify([
			{ date: "2026-07-13", season: "summer", weekday: "monday", day_type: "weekday", segments: {} },
			{ date: "2026-07-14", season: "summer", weekday: "tuesday", day_type: "weekday", segments: {} },
		]);
		const parsed = parseHouseLoadForecastHorizonJson(raw);
		assert.equal(parsed?.length, 2);
		assert.equal(parsed?.[0].date, "2026-07-13");
	});
});
