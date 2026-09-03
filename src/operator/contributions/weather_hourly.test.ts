import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectWeatherHourlyPoints, weatherHourlyDayIndex } from "./weather_hourly";
import { collectContributions, type ContributionsReadHost } from "./read";
import { correctHorizonTempC } from "../../learning/weather/horizon/math";

function hourlyHost(states: Record<string, unknown>): ContributionsReadHost {
	return {
		config: {
			pv_shape_enabled: true,
			pv_shape_brightsky_hourly_prefix: "brightsky.0.hourly",
			pv_shape_kwp_state_1: "pvforecast.0.plants.roofA.power.installed",
			pv_shape_kwp_state_2: "",
			intent_timezone: "Europe/Berlin",
		},
		getStateAsync: async (id: string) => {
			if (id in states) return { val: states[id] } as ioBroker.State;
			if (id === "learning.pv_bias.corrected_today_kwh") return { val: 40 } as ioBroker.State;
			if (id === "learning.pv_bias.status") return { val: "ready" } as ioBroker.State;
			if (id === "learning.weather.status") return { val: "ready" } as ioBroker.State;
			if (id === "learning.weather.health") return { val: "ok" } as ioBroker.State;
			return null;
		},
		setObjectNotExistsAsync: async () => undefined,
		setStateAsync: async () => undefined,
		getForeignStateAsync: async (id: string) => {
			if (id in states) return { val: states[id] } as ioBroker.State;
			if (id === "pvforecast.0.plants.roofA.power.installed") return { val: 5 } as ioBroker.State;
			return null;
		},
		getForeignObjectAsync: async (id: string) => {
			if (id !== "system.config") return null;
			return { common: { latitude: 49.17, longitude: 12.48 } } as unknown as ioBroker.Object;
		},
	};
}

describe("weather hourly temperature forecast", () => {
	it("dayIndex: heute = 1, morgen = 2", () => {
		assert.equal(weatherHourlyDayIndex("2026-08-30", "2026-08-30"), 1);
		assert.equal(weatherHourlyDayIndex("2026-08-30", "2026-08-31"), 2);
	});

	it("vorhandene Stunden-Temperaturen landen in hourlyPoints, fehlende werden nicht erfunden", async () => {
		const now = new Date("2026-08-30T12:00:00.000Z");
		const host = hourlyHost({
			"brightsky.0.hourly.00.timestamp": "2026-08-30T10:00:00.000Z",
			"brightsky.0.hourly.00.temperature": 28.4,
			"brightsky.0.hourly.00.cloud_cover": 10,
			"brightsky.0.hourly.01.timestamp": "2026-08-30T11:00:00.000Z",
			"brightsky.0.hourly.01.temperature": 29.1,
			"brightsky.0.hourly.03.timestamp": "2026-08-30T13:00:00.000Z",
			/* 03: timestamp da, Temperatur fehlt → null, nicht interpoliert */
			"brightsky.0.hourly.02.cloud_cover": 50,
			/* 02: kein timestamp → Stunde existiert nicht */
		});
		const points = await collectWeatherHourlyPoints(host, now, "Europe/Berlin", "brightsky.0.hourly");
		assert.equal(points.length, 3);
		assert.equal(points[0].outdoorTempC, 28.4);
		assert.equal(points[1].outdoorTempC, 29.1);
		assert.equal(points[2].outdoorTempC, null);
		assert.equal(
			points.some((p) => p.startIso === "2026-08-30T12:00:00.000Z"),
			false,
			"Stunde ohne timestamp darf nicht erfunden werden",
		);
	});

	it("wendet vorhandenen Temp-Bias an, ohne fehlende Rohwerte zu erzeugen", async () => {
		const now = new Date("2026-08-30T12:00:00.000Z");
		const host = hourlyHost({
			"learning.weather.temp_bias_c": 2,
			"brightsky.0.hourly.00.timestamp": "2026-08-30T10:00:00.000Z",
			"brightsky.0.hourly.00.temperature": 20,
		});
		const points = await collectWeatherHourlyPoints(host, now, "Europe/Berlin", "brightsky.0.hourly");
		assert.equal(points[0].outdoorTempC, correctHorizonTempC(20, 2, 1));
	});

	it("leerer Prefix liefert keine Punkte; Tages-Horizon bleibt unabhängig", async () => {
		const now = new Date("2026-08-30T12:00:00.000Z");
		const host = hourlyHost({
			"learning.weather.horizon.day1.min_temp_c": 14,
			"learning.weather.horizon.day1.max_temp_c": 28,
			"learning.weather.horizon.day1.quality": "valid",
		});
		const empty = await collectWeatherHourlyPoints(host, now, "Europe/Berlin", "");
		assert.deepEqual(empty, []);
		const { contributions } = await collectContributions(host, now);
		const weather = contributions.find((c) => c.contributionId === "weather_forecast.context");
		const days = weather?.details.horizonDays as Array<{ dayIndex: number; maxTempC: number | null }>;
		assert.equal(days?.find((d) => d.dayIndex === 1)?.maxTempC, 28);
	});

	it("collectContributions verdrahtet hourlyPoints in die Weather-Contribution", async () => {
		const now = new Date("2026-08-30T12:00:00.000Z");
		const host = hourlyHost({
			"brightsky.0.hourly.00.timestamp": "2026-08-30T10:00:00.000Z",
			"brightsky.0.hourly.00.temperature": 27.5,
			"learning.weather.horizon.day1.min_temp_c": 14,
			"learning.weather.horizon.day1.max_temp_c": 28,
			"learning.weather.horizon.day1.quality": "valid",
		});
		const { contributions } = await collectContributions(host, now);
		const weather = contributions.find((c) => c.contributionId === "weather_forecast.context");
		const hourly = weather?.details.hourlyPoints as Array<{ outdoorTempC: number | null }>;
		assert.ok(hourly?.length);
		assert.equal(hourly[0].outdoorTempC, 27.5);
		const days = weather?.details.horizonDays as Array<{ dayIndex: number; maxTempC: number | null }>;
		assert.equal(days?.find((d) => d.dayIndex === 1)?.maxTempC, 28);
	});
});
