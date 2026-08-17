import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { resetHistoryQueryQueueForTests } from "../history_query";
import {
	__hasPvBiasLearningTimerForTest,
	__isLearningTickInFlightForTest,
	__resetLearningRuntimeForTest,
	startPvBiasLearningRuntime,
	stopPvBiasLearning,
	type LearningStateTreeHost,
} from "../pv_bias/index";
import { __resetThermalBoilerRunLockForTest } from "./run";
import { mappingBase } from "../../tree_paths";

const BOILER_MAP = mappingBase("immersion_heater", "boiler_temp_c");

function stubHost(): LearningStateTreeHost {
	const states: Record<string, unknown> = {
		[`${BOILER_MAP}.enabled`]: true,
		[`${BOILER_MAP}.target_state`]: "sensor.0.boiler",
	};
	const log = {
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
		debug: () => undefined,
	};
	return {
		config: {
			learning_pv_bias_enabled: false,
			learning_thermal_runtime_enabled: true,
			learning_thermal_runtime_lookback_days: 7,
			learning_house_load_enabled: false,
			learning_battery_runtime_enabled: false,
			learning_price_enabled: false,
			learning_price_forecast_enabled: false,
			learning_pv_horizon_enabled: false,
			ih_boiler_min_temp_c: 50,
			ih_hygiene_target_temp_c: 60,
		},
		states,
		getStateAsync: async (id: string) => ({ val: states[id] ?? null }) as ioBroker.State,
		setStateAsync: async (id: string, state: ioBroker.SettableState) => {
			states[id] = state.val;
		},
		setObjectNotExistsAsync: async () => undefined,
		getForeignStateAsync: async (id: string) =>
			id === "sensor.0.boiler" ? ({ val: 59 } as ioBroker.State) : ({ val: null } as ioBroker.State),
		getHistoryAsync: async () => ({ result: [] }),
		log,
	} as unknown as LearningStateTreeHost;
}

function stubAdapter(host: LearningStateTreeHost): ioBroker.Adapter {
	return {
		config: host.config,
		log: host.log,
	} as unknown as ioBroker.Adapter;
}

async function waitUntil(predicate: () => boolean, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (predicate()) {
			return;
		}
		await new Promise((r) => setTimeout(r, 20));
	}
}

describe("thermal boiler learning scheduling", () => {
	beforeEach(() => {
		__resetLearningRuntimeForTest();
		__resetThermalBoilerRunLockForTest();
		resetHistoryQueryQueueForTests();
	});

	afterEach(() => {
		stopPvBiasLearning();
		__resetLearningRuntimeForTest();
		__resetThermalBoilerRunLockForTest();
		resetHistoryQueryQueueForTests();
	});

	it("T30: start replaces timer — no duplicate interval after restart", async () => {
		const host = stubHost();
		const adapter = stubAdapter(host);
		await startPvBiasLearningRuntime(adapter, host);
		assert.equal(__hasPvBiasLearningTimerForTest(), true);
		await waitUntil(() => !__isLearningTickInFlightForTest(), 2_000);
		await startPvBiasLearningRuntime(adapter, host);
		assert.equal(__hasPvBiasLearningTimerForTest(), true);
		await waitUntil(() => !__isLearningTickInFlightForTest(), 2_000);
		stopPvBiasLearning();
		assert.equal(__hasPvBiasLearningTimerForTest(), false);
	});

	it("T31: startup tick writes boiler mapping temp before heavy history modules", async () => {
		const host = stubHost();
		const states = (host as unknown as { states: Record<string, unknown> }).states;
		states["learning.thermal_boiler.current_temperature_c"] = 63;
		await startPvBiasLearningRuntime(stubAdapter(host), host);
		await waitUntil(() => states["learning.thermal_boiler.current_temperature_c"] === 59, 2_000);
		assert.equal(states["learning.thermal_boiler.current_temperature_c"], 59);
		assert.match(String(states["learning.thermal_boiler.reason_de"] ?? ""), /59\.0/);
		assert.equal(states["learning.thermal_boiler.trigger_source"], "startup");
		await waitUntil(() => !__isLearningTickInFlightForTest(), 2_000);
		stopPvBiasLearning();
	});
});
