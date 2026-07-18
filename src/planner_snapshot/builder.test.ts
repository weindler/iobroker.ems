import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { readFileSync } from "node:fs";
import { durableDataDirFromRoot } from "../backup_integration/paths.js";
import { resolvePlannerPaths } from "../planner_paths/paths.js";
import { BAT } from "../addons/battery/ensure_states.js";
import { WALLBOX_EVCC_STATES } from "../addons/wallbox/ensure_evcc_states.js";
import { IMMERSION_RUNTIME_STATES } from "../addons/immersion_heater/runtime/types.js";
import { buildPlannerInputSnapshot } from "./builder.js";
import { computeInputRevision } from "./canonical.js";
import {
	assertCoverageMatrixComplete,
	coverageCounts,
	PLANNER_INPUT_COVERAGE_MATRIX,
	PLANNER_SNAPSHOT_FORBIDDEN_STATIC_IMPORTS,
} from "./coverage.js";
import { PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES } from "./constants.js";
import type { PlannerRelevantConfig, PlannerSnapshotSource } from "./source.js";
import type { SnapshotStateValue } from "./types";
import { assertNoForbiddenSnapshotContent, assertSnapshotSerializable, validatePlannerInputSnapshotV2 } from "./validate.js";
import { writePlannerInputSnapshot } from "./write.js";
import { PlannerInputSnapshotBudgetError } from "./types.js";

const MODULE_DIR = path.join(process.cwd(), "src", "planner_snapshot");

function stateVal(value: SnapshotStateValue["value"]): SnapshotStateValue {
	return { value };
}

function fixtureConfig(): PlannerRelevantConfig {
	return {
		timezone: "Europe/Berlin",
		executionMode: "dryrun",
		batteryProfileId: "generic",
		batteryCapacityManualKwh: 10,
		wallboxEvccEnabledStateId: "evcc.0.status.enabled",
		priceForecastTodayStateId: "tibber.0.Homes.Prices.today",
		priceForecastTomorrowStateId: "tibber.0.Homes.Prices.tomorrow",
		immersion: {
			forecastModeEnabled: true,
			planningMaxTempC: 55,
			minRuntimeMin: 30,
			minPauseMin: 15,
			stages: [{ index: 1, enabled: true, nominalPowerW: 2000, label: "Stufe 1" }],
		},
		batteryWinter: {
			enabled: true,
			horizonDays: 7,
			socTargetMinPct: 30,
			socTargetMaxPct: 80,
		},
		acUnits: [{ index: 1, enabled: true, targetTempC: 22 }],
		weather: {
			temp: { actualStateId: "weather.0.forecast.current.temp", forecastStateId: "weather.0.forecast.day0.temp" },
			cloud: { actualStateId: "weather.0.forecast.current.clouds", forecastStateId: null },
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

function createMockSource(
	overrides: {
		states?: Record<string, SnapshotStateValue>;
		foreign?: Record<string, SnapshotStateValue>;
		config?: PlannerRelevantConfig;
		now?: Date;
	} = {},
): PlannerSnapshotSource {
	const states = new Map(Object.entries(overrides.states ?? {}));
	const foreign = new Map(Object.entries(overrides.foreign ?? {}));
	const config = overrides.config ?? fixtureConfig();
	const now = overrides.now ?? new Date("2026-07-01T12:00:00.000Z");
	return {
		async readState(id) {
			return states.get(id) ?? { value: null };
		},
		async readForeignState(id) {
			return foreign.get(id) ?? { value: null };
		},
		async readJsonFile() {
			return null;
		},
		async readConfig() {
			return config;
		},
		now() {
			return now;
		},
	};
}

function realisticFixtureSource(tmpDir: string): PlannerSnapshotSource {
	const houseDir = path.join(tmpDir, "house_load");
	const thermalDir = path.join(tmpDir, "thermal_runtime");
	const consumerDir = path.join(tmpDir, "consumer_stats");
	return createMockSource({
		config: {
			...fixtureConfig(),
			dataPaths: {
				houseLoadLearningDir: houseDir,
				thermalRuntimeLearningDir: thermalDir,
				consumerStatsDir: consumerDir,
			},
		},
		states: {
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
		},
		foreign: {
			"weather.0.forecast.current.temp": stateVal(19.2),
			"weather.0.forecast.current.clouds": stateVal(25),
			"tibber.0.Homes.Prices.today": stateVal(
				JSON.stringify({
					today: [{ total: 0.28, startsAt: "2026-07-01T10:00:00+02:00" }],
				}),
			),
		},
	});
}

describe("planner_snapshot builder", () => {
	it("builds serializable snapshot with stable revision semantics", async () => {
		const source = realisticFixtureSource(os.tmpdir());
		const snap = await buildPlannerInputSnapshot(source);
		assertSnapshotSerializable(snap);
		assertNoForbiddenSnapshotContent(snap);
		assert.ok(validatePlannerInputSnapshotV2(snap));
		assert.equal(snap.timezone, "Europe/Berlin");
		assert.equal(snap.live.pvPowerW, 1500);
		assert.equal(snap.live.houseLoadW, 900);
		assert.equal(snap.inputRevision, computeInputRevision({ ...snap, inputRevision: "" }));
	});

	it("does not coerce missing values to zero", async () => {
		const source = createMockSource({
			states: {
				"live.pv.power_w": stateVal(null),
				"live.battery.pv_ac_power_w": stateVal(null),
				"live.battery.house_load_w": stateVal(null),
			},
		});
		const snap = await buildPlannerInputSnapshot(source);
		assert.equal(snap.live.pvPowerW, null);
		assert.equal(snap.live.houseLoadW, null);
	});

	it("reads each state at most once", async () => {
		const counts = new Map<string, number>();
		const inner = realisticFixtureSource(os.tmpdir());
		const source: PlannerSnapshotSource = {
			readState: async (id) => {
				counts.set(`state:${id}`, (counts.get(`state:${id}`) ?? 0) + 1);
				return inner.readState(id);
			},
			readForeignState: async (id) => {
				counts.set(`foreign:${id}`, (counts.get(`foreign:${id}`) ?? 0) + 1);
				return inner.readForeignState(id);
			},
			readJsonFile: inner.readJsonFile.bind(inner),
			readConfig: inner.readConfig.bind(inner),
			now: inner.now.bind(inner),
		};
		await buildPlannerInputSnapshot(source);
		for (const [key, count] of counts) {
			assert.ok(count <= 1, `${key} read ${count} times`);
		}
	});

	it("capturedAt alone does not change inputRevision", async () => {
		const snap = await buildPlannerInputSnapshot(createMockSource());
		const altCaptured = { ...snap, capturedAt: "2099-01-01T00:00:00.000Z" };
		assert.equal(computeInputRevision(snap), computeInputRevision(altCaptured));
	});

	it("realistic fixture stays within budget", async () => {
		const snap = await buildPlannerInputSnapshot(realisticFixtureSource(os.tmpdir()));
		const bytes = Buffer.byteLength(`${JSON.stringify(snap, null, 2)}\n`, "utf8");
		assert.ok(bytes <= PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES, `fixture size ${bytes}`);
	});

	it("detects forbidden static imports", () => {
		const files = ["builder.ts", "canonical.ts", "write.ts", "source.ts", "index.ts"];
		for (const file of files) {
			const text = readFileSync(path.join(MODULE_DIR, file), "utf8");
			for (const forbidden of PLANNER_SNAPSHOT_FORBIDDEN_STATIC_IMPORTS) {
				const escaped = forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
				const importFrom = new RegExp(`from\\s+["'][^"']*${escaped}[^"']*["']`);
				const requireCall = new RegExp(`require\\(\\s*["'][^"']*${escaped}[^"']*["']\\s*\\)`);
				assert.ok(!importFrom.test(text) && !requireCall.test(text), `${file} must not import ${forbidden}`);
			}
		}
	});

	it("coverage matrix has no unresolved entries", () => {
		assertCoverageMatrixComplete();
		const counts = coverageCounts();
		assert.equal(counts.unresolved, 0);
		assert.ok(counts.covered > 0);
		assert.ok(PLANNER_INPUT_COVERAGE_MATRIX.length > 0);
	});
});

describe("planner_snapshot write", () => {
	it("writes input.json atomically under runtime job dir", async () => {
		const root = path.join(os.tmpdir(), `ems-snap-write-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths(durable);
		const jobDir = layout.jobDir("job-snap-1");
		await fs.mkdir(jobDir, { recursive: true });
		const snap = await buildPlannerInputSnapshot(realisticFixtureSource(root));

		const result = await writePlannerInputSnapshot(jobDir, snap, {
			runtimeRootDir: layout.runtimePlannerDir,
			durableDataDir: durable,
		});
		assert.equal(path.basename(result.path), "input.json");
		assert.equal(result.inputRevision, snap.inputRevision);
		const disk = JSON.parse(await fs.readFile(result.path, "utf8"));
		assert.ok(validatePlannerInputSnapshotV2(disk));
	});

	it("rejects durable dataFolder paths", async () => {
		const root = path.join(os.tmpdir(), `ems-snap-durable-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const snap = await buildPlannerInputSnapshot(createMockSource());
		await assert.rejects(
			() =>
				writePlannerInputSnapshot(path.join(durable, "planner", "jobs", "x"), snap, {
					runtimeRootDir: path.join(durable, "runtime"),
					durableDataDir: durable,
				}),
			/path outside allowed root|job path must not be under durable/i,
		);
	});

	it("rejects traversal in job dir", async () => {
		const root = path.join(os.tmpdir(), `ems-snap-traversal-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths(durable);
		const snap = await buildPlannerInputSnapshot(createMockSource());
		await assert.rejects(
			() =>
				writePlannerInputSnapshot(path.join(layout.runtimeJobsDir, "..", "..", "escape"), snap, {
					runtimeRootDir: layout.runtimePlannerDir,
					durableDataDir: durable,
				}),
			/path outside allowed root|invalid job|must not|traversal|within root/i,
		);
	});

	it("rejects snapshots exceeding budget", async () => {
		const root = path.join(os.tmpdir(), `ems-snap-budget-${Date.now()}`);
		const durable = durableDataDirFromRoot(root, 0);
		const layout = resolvePlannerPaths(durable);
		const jobDir = layout.jobDir("job-budget");
		await fs.mkdir(jobDir, { recursive: true });
		const snap = await buildPlannerInputSnapshot(createMockSource());
		const huge = {
			...snap,
			learning: {
				...snap.learning,
				thermalRuntime: {
					...snap.learning.thermalRuntime,
					history: Array.from({ length: 5000 }, (_, i) => ({
						startTs: i,
						endTs: i + 1,
						startTempC: 50,
						endTempC: 49,
						runtimeHours: 1,
						coolingRateCPerH: 1,
						season: "summer",
						dayType: "weekday",
					})),
				},
			},
		};
		huge.inputRevision = computeInputRevision({ ...huge, inputRevision: "" });
		await assert.rejects(
			() =>
				writePlannerInputSnapshot(jobDir, huge, {
					runtimeRootDir: layout.runtimePlannerDir,
					durableDataDir: durable,
				}),
			PlannerInputSnapshotBudgetError,
		);
	});
});
