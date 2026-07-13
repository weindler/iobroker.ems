import { BAT } from "../addons/battery/ensure_states";
import { WALLBOX_EVCC_STATES } from "../addons/wallbox/ensure_evcc_states";
import { IMMERSION_RUNTIME_STATES } from "../addons/immersion_heater/runtime/types";
import type { SnapshotStateValue } from "./types";
import type { PlannerRelevantConfig, PlannerSnapshotSource } from "./source";
import type { PlannerSnapshotIoBrokerHost } from "./iobroker_source";

export function stateVal(value: SnapshotStateValue["value"]): SnapshotStateValue {
	return { value };
}

export function parityFixtureConfig(): PlannerRelevantConfig {
	return {
		timezone: "Europe/Berlin",
		executionMode: "dryrun",
		batteryProfileId: "generic_readonly",
		batteryCapacityManualKwh: 10,
		wallboxEvccEnabledStateId: "evcc.0.status.enabled",
		priceForecastTodayStateId: "tibber.0.Homes.Prices.today",
		priceForecastTomorrowStateId: "tibber.0.Homes.Prices.tomorrow",
		immersion: {
			forecastModeEnabled: true,
			planningMaxTempC: 55,
			minRuntimeMin: 30,
			minPauseMin: 15,
			stages: [{ index: 1, enabled: true, nominalPowerW: 2000, label: "Ein/Aus" }],
		},
		batteryWinter: {
			enabled: true,
			horizonDays: 7,
			socTargetMinPct: 30,
			socTargetMaxPct: 80,
		},
		acUnits: [{ index: 1, enabled: true, targetTempC: 22 }],
		weather: {
			temp: {
				actualStateId: "weather.0.forecast.current.temp",
				forecastStateId: "weather.0.forecast.day0.temp",
			},
			cloud: {
				actualStateId: "weather.0.forecast.current.clouds",
				forecastStateId: null,
			},
		},
		adminPolicy: {
			gridImportAllowed: true,
			maxGridImportW: 5000,
			houseFuseLimitW: 11000,
			energyPriority: ["pv", "battery"],
			mutualExclusions: [],
		},
		dataPaths: {
			houseLoadLearningDir: null,
			thermalRuntimeLearningDir: null,
			consumerStatsDir: null,
		},
	};
}

export function parityFixtureTibberTodayJson(): string {
	return JSON.stringify([
		{ total: 0.28, startsAt: "2026-07-01T12:00:00.000Z" },
		{ total: 0.3, startsAt: "2026-07-01T12:15:00.000Z" },
		{ total: 0.25, startsAt: "2026-07-01T12:30:00.000Z" },
		{ total: 0.32, startsAt: "2026-07-01T12:45:00.000Z" },
	]);
}

export function parityFixtureStates(): Record<string, SnapshotStateValue> {
	return {
		"live.pv.power_w": stateVal(1500),
		"live.battery.house_load_w": stateVal(900),
		"live.battery.soc_pct": stateVal(62),
		"live.thermal.buffer_temp_c": stateVal(44),
		"live.price.now_ct_per_kwh": stateVal(31.2),
		"economics.config.fixed_price_ct_per_kwh": stateVal(null),
		"global_modes.active": stateVal("balanced"),
		"policy.global.revision": stateVal("pol-rev-abc"),
		"policy.global.status": stateVal("ready"),
		"policy.global.effective_json": stateVal(
			JSON.stringify({
				economics: { gridImportAllowed: { value: true } },
				limits: { maxGridImportW: { value: 4800 }, houseFuseLimitW: { value: 11000 } },
				preferences: { energyPriority: { value: ["pv", "battery"] } },
				protection: { mutualExclusions: { value: [] } },
			}),
		),
		"user_intent.thermal.resolved_json": stateVal(
			JSON.stringify({
				domain: "thermal",
				intent_state: "active",
				operating_request: { status: "valid", value: "auto" },
			}),
		),
		"user_intent.battery.resolved_json": stateVal(
			JSON.stringify({
				domain: "battery",
				operating_request: { status: "valid", value: "self_consumption" },
				top_off_requested: { status: "valid", value: false },
			}),
		),
		"learning.pv_bias.corrected_today_kwh": stateVal(11.5),
		"learning.pv_bias.corrected_tomorrow_kwh": stateVal(13.2),
		"learning.pv_bias.raw_today_kwh": stateVal(10.8),
		"learning.pv_bias.raw_tomorrow_kwh": stateVal(12.9),
		"learning.pv_bias.confidence_pct": stateVal(82),
		"learning.pv_bias.status": stateVal("ready"),
		"learning.pv_bias.last_update_ts": stateVal("2026-07-01T11:30:00.000Z"),
		"learning.house_load.status": stateVal("ready"),
		"learning.house_load.confidence": stateVal(0.75),
		"learning.house_load.forecast_today_json": stateVal(null),
		"learning.house_load.forecast_tomorrow_json": stateVal(null),
		"learning.house_load.last_update": stateVal("2026-07-01T10:00:00.000Z"),
		"learning.weather.status": stateVal("ready"),
		"learning.weather.health": stateVal("ok"),
		"learning.weather.confidence_pct": stateVal(70),
		"learning.weather.last_update": stateVal("2026-07-01T09:00:00.000Z"),
		"learning.weather.forecast_source": stateVal("openmeteo"),
		"learning.weather.actual_source": stateVal("weather.forecast"),
		"learning.thermal_runtime.status": stateVal("ready"),
		"learning.thermal_runtime.health": stateVal("ok"),
		"learning.thermal_runtime.samples": stateVal(8),
		"learning.thermal_runtime.runtime_hours_avg": stateVal(3.8),
		"learning.thermal_runtime.runtime_hours_median": stateVal(3.5),
		"learning.thermal_runtime.cooling_rate_c_per_h_avg": stateVal(1.1),
		"learning.thermal_runtime.cooling_k_per_h": stateVal(0.07),
		"learning.thermal_runtime.cooling_asymptote_c": stateVal(21),
		"learning.thermal_runtime.cooling_asymptote_source": stateVal("fitted"),
		"learning.thermal_runtime.current_temperature_c": stateVal(44),
		"learning.thermal_runtime.estimated_remaining_hours": stateVal(5.5),
		"learning.thermal_runtime.estimated_empty_at": stateVal("2026-07-01T17:30:00.000Z"),
		"ems_mirror.snow_cover_suspected": stateVal(false),
		"addons.battery.enabled": stateVal(true),
		"addons.wallbox.enabled": stateVal(true),
		"addons.immersion_heater.enabled": stateVal(true),
		"addons.air_conditioning.enabled": stateVal(true),
		"addons.battery.governance.enabled": stateVal(true),
		"addons.wallbox.governance.enabled": stateVal(true),
		"addons.immersion_heater.governance.enabled": stateVal(true),
		"addons.climate.governance.enabled": stateVal(true),
		"addons.battery.governance.ai_optimization_allowed": stateVal(true),
		"addons.immersion_heater.governance.ai_optimization_allowed": stateVal(true),
		"optional.missing.state": stateVal(null),
		"edge.zero_w": stateVal(0),
		"edge.false_flag": stateVal(false),
		"edge.empty_string": stateVal(""),
		[BAT.telemetry.socPct]: stateVal(62),
		[BAT.telemetry.capacityEffectiveKwh]: stateVal(10.2),
		[BAT.identity.capacityNetKwh]: stateVal(10),
		[BAT.identity.capacitySource]: stateVal("manual"),
		[BAT.limits.hardwareMinSocPct]: stateVal(10),
		[BAT.limits.hardwareMaxSocPct]: stateVal(100),
		[BAT.limits.effectiveMaxChargeW]: stateVal(5000),
		[BAT.capabilities.setChargePower]: stateVal(true),
		[BAT.capabilities.setDischargePower]: stateVal(true),
		[BAT.status.fault]: stateVal(false),
		[BAT.status.lockout]: stateVal(false),
		[BAT.telemetry.valid]: stateVal(true),
		[BAT.telemetry.stale]: stateVal(false),
		[BAT.status.telemetryReady]: stateVal(true),
		[BAT.runtime.ownershipActive]: stateVal(false),
		"planner.intent.battery.winter.active": stateVal(false),
		[WALLBOX_EVCC_STATES.connected]: stateVal(false),
		[WALLBOX_EVCC_STATES.charging]: stateVal(false),
		[WALLBOX_EVCC_STATES.batteryMode]: stateVal("normal"),
		[WALLBOX_EVCC_STATES.batteryDischargeControl]: stateVal(false),
		[IMMERSION_RUNTIME_STATES.bufferTemperatureC]: stateVal(44),
		[IMMERSION_RUNTIME_STATES.faultActive]: stateVal(false),
		[IMMERSION_RUNTIME_STATES.state]: stateVal("auto_ready"),
		"addons.air_conditioning.units.unit_1.room_temp_c": stateVal(24.5),
		"addons.air_conditioning.units.unit_1.state": stateVal("idle"),
		"addons.air_conditioning.units.unit_1.cleaning_active": stateVal(false),
		"learning.pv_horizon.day3.corrected_kwh": stateVal(9),
		"learning.pv_horizon.day4.corrected_kwh": stateVal(8.5),
		"learning.pv_horizon.day5.corrected_kwh": stateVal(8),
		"learning.pv_horizon.day6.corrected_kwh": stateVal(7.5),
		"learning.pv_horizon.day7.corrected_kwh": stateVal(7),
		"learning.pv_horizon.day3.confidence_pct": stateVal(60),
		"learning.pv_horizon.day4.confidence_pct": stateVal(58),
		"learning.pv_horizon.day5.confidence_pct": stateVal(55),
		"learning.pv_horizon.day6.confidence_pct": stateVal(52),
		"learning.pv_horizon.day7.confidence_pct": stateVal(50),
	};
}

export function parityFixtureForeign(): Record<string, SnapshotStateValue> {
	return {
		"weather.0.forecast.current.temp": stateVal(19.2),
		"weather.0.forecast.current.clouds": stateVal(25),
		"tibber.0.Homes.Prices.today": stateVal(parityFixtureTibberTodayJson()),
	};
}

export function createParityFixtureSource(
	overrides: {
		states?: Record<string, SnapshotStateValue>;
		foreign?: Record<string, SnapshotStateValue>;
		config?: PlannerRelevantConfig;
		now?: Date;
		jsonFiles?: Record<string, unknown>;
	} = {},
): PlannerSnapshotSource {
	const states = { ...parityFixtureStates(), ...overrides.states };
	const foreign = { ...parityFixtureForeign(), ...overrides.foreign };
	const config = overrides.config ?? parityFixtureConfig();
	const now = overrides.now ?? new Date("2026-07-01T12:00:00.000Z");
	const jsonFiles = overrides.jsonFiles ?? {};
	return {
		readState: async (id) => states[id] ?? { value: null },
		readForeignState: async (id) => foreign[id] ?? { value: null },
		readJsonFile: async (p) => (jsonFiles[p] as never) ?? null,
		readConfig: async () => config,
		now: () => now,
	};
}

export function createParityIoBrokerHost(
	overrides: {
		states?: Record<string, { val: unknown; ts?: number }>;
		foreign?: Record<string, { val: unknown; ts?: number }>;
		config?: Record<string, unknown>;
		now?: Date;
	} = {},
): PlannerSnapshotIoBrokerHost {
	const states = overrides.states ?? {};
	const foreign = overrides.foreign ?? {};
	for (const [id, st] of Object.entries(parityFixtureStates())) {
		if (!states[id]) {
			states[id] = { val: st.value, ts: Date.parse("2026-07-01T12:00:00.000Z") };
		}
	}
	for (const [id, st] of Object.entries(parityFixtureForeign())) {
		if (!foreign[id]) {
			foreign[id] = { val: st.value, ts: Date.parse("2026-07-01T12:00:00.000Z") };
		}
	}
	const config = overrides.config ?? {
		global_execution_mode: "dryrun",
		intent_timezone: "Europe/Berlin",
		learning_weather_forecast_temp_state: "weather.0.forecast.day0.temp",
		learning_weather_actual_temp_state: "weather.0.forecast.current.temp",
		learning_weather_forecast_cloud_state: "weather.0.forecast.current.clouds",
		learning_weather_actual_cloud_state: "weather.0.forecast.current.clouds",
		learning_price_forecast_today_json_state: "tibber.0.Homes.Prices.today",
		learning_price_forecast_tomorrow_json_state: "tibber.0.Homes.Prices.tomorrow",
		wb_evcc_enabled_state: "evcc.0.status.enabled",
		global_policy_grid_import_allowed: true,
		global_policy_max_grid_import_w: 5000,
		global_policy_house_fuse_limit_w: 11000,
		global_policy_energy_priority_json: '["pv","battery"]',
		global_policy_mutual_exclusions_json: "[]",
		ih_stage_count: 1,
		ih_stage_1_enabled: true,
		ih_stage_1_nominal_power_w: 2000,
		ih_planning_max_temp_c: 55,
		ih_minimum_runtime_sec: 1800,
		ih_minimum_pause_sec: 900,
		ih_forecast_mode_enabled: true,
		ac_u1_enabled: true,
		ac_u1_cooling_setpoint_c: 22,
		bat_winter_plan_enabled: true,
		bat_winter_plan_horizon_days: 7,
		battery_profile: "generic_readonly",
		bat_hw_min_soc_pct: 30,
		bat_hw_max_soc_pct: 80,
	};
	return {
		config,
		getStateAsync: async (id) => {
			const st = states[id];
			return st ? ({ val: st.val, ts: st.ts ?? 0, lc: st.ts ?? 0, ack: true } as ioBroker.State) : null;
		},
		getForeignStateAsync: async (id) => {
			const st = foreign[id];
			return st ? ({ val: st.val, ts: st.ts ?? 0, lc: st.ts ?? 0, ack: true } as ioBroker.State) : null;
		},
	};
}
