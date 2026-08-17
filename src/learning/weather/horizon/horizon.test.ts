import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	correctHorizonTempC,
	dailyTempBiasSample,
	effectiveTempBiasC,
	emaBiasC,
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
				return v === null
					? { val: null, ack: true, ts: 1, lc: 1, from: "t" }
					: { val: v, ack: true, ts: 1, lc: 1, from: "t" };
			},
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				states.set(id, { val: st.val as ioBroker.StateValue, ack: st.ack === true });
			},
			log: { info: () => undefined, warn: () => undefined, debug: () => undefined },
		},
	};
}

describe("weather horizon math", () => {
	it("applies weighted additive bias like PV", () => {
		assert.equal(effectiveTempBiasC(2, 1), 2);
		assert.equal(effectiveTempBiasC(2, 2), 1.8);
		assert.equal(correctHorizonTempC(10, 2, 1), 12);
		assert.equal(correctHorizonTempC(null, 2, 1), null);
		assert.equal(correctHorizonTempC(10, null, 1), 10);
		assert.equal(dailyTempBiasSample(12, 10), 2);
		assert.equal(emaBiasC(null, 4), 4);
	});
});

describe("weather horizon config", () => {
	it("parses day 1-7 mappings", () => {
		const cfg = weatherHorizonConfigFromAdapter({
			learning_weather_horizon_day1_min_temp_state: "brightsky.0.daily.00.temperature_min",
			learning_weather_horizon_day1_max_temp_state: "brightsky.0.daily.00.temperature_max",
			learning_weather_horizon_day3_min_temp_state: "brightsky.0.daily.02.temperature_min",
		});
		assert.equal(cfg.enabled, true);
		assert.equal(cfg.days[0].dayIndex, 1);
		assert.equal(cfg.days[0].minTempStateId, "brightsky.0.daily.00.temperature_min");
		assert.equal(cfg.days[2].dayIndex, 3);
		assert.equal(cfg.days[6].dayIndex, 7);
	});
});

describe("weather horizon run", () => {
	it("writes raw+corrected for day1-7 and leaves unmapped as missing", async () => {
		const mock = mockHost(
			{
				learning_weather_horizon_enabled: true,
				learning_weather_horizon_day1_min_temp_state: "bs.min1",
				learning_weather_horizon_day1_max_temp_state: "bs.max1",
				learning_weather_horizon_day3_min_temp_state: "bs.min3",
				learning_weather_horizon_day3_max_temp_state: "bs.max3",
				learning_weather_actual_temp_state: "live.temp",
				learning_weather_forecast_temp_state: "fc.temp",
			},
			{ "bs.min1": 8, "bs.max1": 18, "bs.min3": 12.5, "bs.max3": 21, "live.temp": 14 },
		);
		mock.states.set("learning.weather.temp_bias_c", { val: 1, ack: true });
		await ensureWeatherHorizonStates(mock.host as import("../../../ems_light/state_util.js").StateHost);
		await runWeatherHorizon(mock.host as unknown as import("./run.js").WeatherHorizonRunHost);

		const d1 = weatherHorizonDayStatePrefix(1);
		assert.equal(mock.states.get(`${d1}.min_temp_c`)?.val, 9); // +1°C full weight
		assert.equal(mock.states.get(`${d1}.quality`)?.val, "valid");
		const d3 = weatherHorizonDayStatePrefix(3);
		assert.equal(mock.states.get(`${d3}.min_temp_c`)?.val, 13.3); // +1 * 0.8
		const d2 = weatherHorizonDayStatePrefix(2);
		assert.equal(mock.states.get(`${d2}.quality`)?.val, "missing");
		assert.equal(mock.states.get("learning.weather.horizon.freeze_date")?.val?.toString().length, 10);
		assert.equal(mock.states.get("learning.weather.horizon.observed_min_temp_c")?.val, 14);
	});
});
