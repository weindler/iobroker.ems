import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	ensureWeatherHorizonStates,
	runWeatherHorizon,
	weatherHorizonConfigFromAdapter,
	weatherHorizonDayStatePrefix,
} from "./index.js";

type MemState = { val: ioBroker.StateValue; ack: boolean };

function mockHost(config: Record<string, unknown>, foreign: Record<string, number | null> = {}) {
	const objects = new Set<string>();
	const states = new Map<string, MemState>();
	return {
		objects,
		states,
		host: {
			config,
			setObjectNotExistsAsync: async (id: string) => {
				objects.add(id);
			},
			getStateAsync: async (id: string) => states.get(id) ?? null,
			getForeignStateAsync: async (id: string) => {
				if (!(id in foreign)) return null;
				const v = foreign[id];
				return v === null ? { val: null, ack: true, ts: 1, lc: 1, from: "t" } : { val: v, ack: true, ts: 1, lc: 1, from: "t" };
			},
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				states.set(id, { val: st.val as ioBroker.StateValue, ack: st.ack === true });
			},
			log: { info: () => undefined, warn: () => undefined, debug: () => undefined },
		},
	};
}

describe("weather horizon config", () => {
	it("parses day 3-7 mappings and defaults enabled", () => {
		const cfg = weatherHorizonConfigFromAdapter({
			learning_weather_horizon_day3_min_temp_state: "brightsky.0.daily.02.temperature_min",
			learning_weather_horizon_day3_max_temp_state: "brightsky.0.daily.02.temperature_max",
		});
		assert.equal(cfg.enabled, true);
		assert.equal(cfg.days[0].dayIndex, 3);
		assert.equal(cfg.days[0].minTempStateId, "brightsky.0.daily.02.temperature_min");
		assert.equal(cfg.days[4].dayIndex, 7);
		assert.equal(cfg.days[4].minTempStateId, "");
	});
});

describe("weather horizon run", () => {
	it("writes valid min/max and leaves unmapped days as missing (no fake 0)", async () => {
		const mock = mockHost(
			{
				learning_weather_horizon_enabled: true,
				learning_weather_horizon_day3_min_temp_state: "bs.min3",
				learning_weather_horizon_day3_max_temp_state: "bs.max3",
			},
			{ "bs.min3": 12.5, "bs.max3": 21 },
		);
		await ensureWeatherHorizonStates(mock.host as import("../../../ems_light/state_util.js").StateHost);
		await runWeatherHorizon(mock.host as unknown as import("./run.js").WeatherHorizonRunHost);

		const d3 = weatherHorizonDayStatePrefix(3);
		assert.equal(mock.states.get(`${d3}.min_temp_c`)?.val, 12.5);
		assert.equal(mock.states.get(`${d3}.max_temp_c`)?.val, 21);
		assert.equal(mock.states.get(`${d3}.quality`)?.val, "valid");
		const d4 = weatherHorizonDayStatePrefix(4);
		assert.equal(mock.states.get(`${d4}.min_temp_c`)?.val, null);
		assert.equal(mock.states.get(`${d4}.quality`)?.val, "missing");
		assert.equal(mock.states.get("learning.weather.horizon.days_available")?.val, 1);
		assert.equal(mock.states.get("learning.weather.horizon.status")?.val, "ready");
	});

	it("partial mapping is degraded, not fabricated", async () => {
		const mock = mockHost(
			{
				learning_weather_horizon_day5_min_temp_state: "bs.min5",
			},
			{ "bs.min5": 8 },
		);
		await ensureWeatherHorizonStates(mock.host as import("../../../ems_light/state_util.js").StateHost);
		await runWeatherHorizon(mock.host as unknown as import("./run.js").WeatherHorizonRunHost);
		const d5 = weatherHorizonDayStatePrefix(5);
		assert.equal(mock.states.get(`${d5}.min_temp_c`)?.val, 8);
		assert.equal(mock.states.get(`${d5}.max_temp_c`)?.val, null);
		assert.equal(mock.states.get(`${d5}.quality`)?.val, "degraded");
	});
});
