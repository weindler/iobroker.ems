"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const os = __importStar(require("node:os"));
const node_fs_1 = require("node:fs");
const paths_js_1 = require("../backup_integration/paths.js");
const paths_js_2 = require("../planner_paths/paths.js");
const ensure_states_js_1 = require("../addons/battery/ensure_states.js");
const ensure_evcc_states_js_1 = require("../addons/wallbox/ensure_evcc_states.js");
const types_js_1 = require("../addons/immersion_heater/runtime/types.js");
const builder_js_1 = require("./builder.js");
const canonical_js_1 = require("./canonical.js");
const coverage_js_1 = require("./coverage.js");
const constants_js_1 = require("./constants.js");
const validate_js_1 = require("./validate.js");
const write_js_1 = require("./write.js");
const types_js_2 = require("./types.js");
const MODULE_DIR = path.join(process.cwd(), "src", "planner_snapshot");
function stateVal(value) {
    return { value };
}
function fixtureConfig() {
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
function createMockSource(overrides = {}) {
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
function realisticFixtureSource(tmpDir) {
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
            "policy.global.effective_json": stateVal(JSON.stringify({
                economics: { gridImportAllowed: { value: true } },
                limits: { maxGridImportW: { value: 4800 }, houseFuseLimitW: { value: 11000 } },
                preferences: { energyPriority: { value: ["pv", "battery"] } },
                protection: { mutualExclusions: { value: [] } },
            })),
            "user_intent.thermal.resolved_json": stateVal(JSON.stringify({
                domain: "thermal",
                intent_state: "active",
                operating_request: { status: "valid", value: "auto" },
            })),
            "user_intent.battery.resolved_json": stateVal(JSON.stringify({
                domain: "battery",
                operating_request: { status: "valid", value: "self_consumption" },
                top_off_requested: { status: "valid", value: false },
            })),
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
            [ensure_states_js_1.BAT.telemetry.socPct]: stateVal(62),
            [ensure_states_js_1.BAT.telemetry.capacityEffectiveKwh]: stateVal(10.2),
            [ensure_states_js_1.BAT.identity.capacityNetKwh]: stateVal(10),
            [ensure_states_js_1.BAT.identity.capacitySource]: stateVal("manual"),
            [ensure_states_js_1.BAT.limits.hardwareMinSocPct]: stateVal(10),
            [ensure_states_js_1.BAT.limits.hardwareMaxSocPct]: stateVal(100),
            [ensure_states_js_1.BAT.limits.effectiveMaxChargeW]: stateVal(5000),
            [ensure_states_js_1.BAT.capabilities.setChargePower]: stateVal(true),
            [ensure_states_js_1.BAT.capabilities.setDischargePower]: stateVal(true),
            [ensure_states_js_1.BAT.status.fault]: stateVal(false),
            [ensure_states_js_1.BAT.status.lockout]: stateVal(false),
            [ensure_states_js_1.BAT.telemetry.valid]: stateVal(true),
            [ensure_states_js_1.BAT.telemetry.stale]: stateVal(false),
            [ensure_states_js_1.BAT.status.telemetryReady]: stateVal(true),
            [ensure_states_js_1.BAT.runtime.ownershipActive]: stateVal(false),
            "planner.intent.battery.winter.active": stateVal(false),
            [ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.connected]: stateVal(false),
            [ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.charging]: stateVal(false),
            [ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryMode]: stateVal("normal"),
            [ensure_evcc_states_js_1.WALLBOX_EVCC_STATES.batteryDischargeControl]: stateVal(false),
            [types_js_1.IMMERSION_RUNTIME_STATES.bufferTemperatureC]: stateVal(44),
            [types_js_1.IMMERSION_RUNTIME_STATES.faultActive]: stateVal(false),
            [types_js_1.IMMERSION_RUNTIME_STATES.state]: stateVal("auto_ready"),
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
            "tibber.0.Homes.Prices.today": stateVal(JSON.stringify({
                today: [{ total: 0.28, startsAt: "2026-07-01T10:00:00+02:00" }],
            })),
        },
    });
}
(0, node_test_1.describe)("planner_snapshot builder", () => {
    (0, node_test_1.it)("builds serializable snapshot with stable revision semantics", async () => {
        const source = realisticFixtureSource(os.tmpdir());
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(source);
        (0, validate_js_1.assertSnapshotSerializable)(snap);
        (0, validate_js_1.assertNoForbiddenSnapshotContent)(snap);
        strict_1.default.ok((0, validate_js_1.validatePlannerInputSnapshotV2)(snap));
        strict_1.default.equal(snap.timezone, "Europe/Berlin");
        strict_1.default.equal(snap.live.pvPowerW, 1500);
        strict_1.default.equal(snap.live.houseLoadW, 900);
        strict_1.default.equal(snap.inputRevision, (0, canonical_js_1.computeInputRevision)({ ...snap, inputRevision: "" }));
    });
    (0, node_test_1.it)("does not coerce missing values to zero", async () => {
        const source = createMockSource({
            states: {
                "live.pv.power_w": stateVal(null),
                "live.battery.pv_ac_power_w": stateVal(null),
                "live.battery.house_load_w": stateVal(null),
            },
        });
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(source);
        strict_1.default.equal(snap.live.pvPowerW, null);
        strict_1.default.equal(snap.live.houseLoadW, null);
    });
    (0, node_test_1.it)("reads each state at most once", async () => {
        const counts = new Map();
        const inner = realisticFixtureSource(os.tmpdir());
        const source = {
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
        await (0, builder_js_1.buildPlannerInputSnapshot)(source);
        for (const [key, count] of counts) {
            strict_1.default.ok(count <= 1, `${key} read ${count} times`);
        }
    });
    (0, node_test_1.it)("capturedAt alone does not change inputRevision", async () => {
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(createMockSource());
        const altCaptured = { ...snap, capturedAt: "2099-01-01T00:00:00.000Z" };
        strict_1.default.equal((0, canonical_js_1.computeInputRevision)(snap), (0, canonical_js_1.computeInputRevision)(altCaptured));
    });
    (0, node_test_1.it)("realistic fixture stays within budget", async () => {
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(realisticFixtureSource(os.tmpdir()));
        const bytes = Buffer.byteLength(`${JSON.stringify(snap, null, 2)}\n`, "utf8");
        strict_1.default.ok(bytes <= constants_js_1.PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES, `fixture size ${bytes}`);
    });
    (0, node_test_1.it)("detects forbidden static imports", () => {
        const files = ["builder.ts", "canonical.ts", "write.ts", "source.ts", "index.ts"];
        for (const file of files) {
            const text = (0, node_fs_1.readFileSync)(path.join(MODULE_DIR, file), "utf8");
            for (const forbidden of coverage_js_1.PLANNER_SNAPSHOT_FORBIDDEN_STATIC_IMPORTS) {
                const escaped = forbidden.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                const importFrom = new RegExp(`from\\s+["'][^"']*${escaped}[^"']*["']`);
                const requireCall = new RegExp(`require\\(\\s*["'][^"']*${escaped}[^"']*["']\\s*\\)`);
                strict_1.default.ok(!importFrom.test(text) && !requireCall.test(text), `${file} must not import ${forbidden}`);
            }
        }
    });
    (0, node_test_1.it)("coverage matrix has no unresolved entries", () => {
        (0, coverage_js_1.assertCoverageMatrixComplete)();
        const counts = (0, coverage_js_1.coverageCounts)();
        strict_1.default.equal(counts.unresolved, 0);
        strict_1.default.ok(counts.covered > 0);
        strict_1.default.ok(coverage_js_1.PLANNER_INPUT_COVERAGE_MATRIX.length > 0);
    });
});
(0, node_test_1.describe)("planner_snapshot write", () => {
    (0, node_test_1.it)("writes input.json atomically under runtime job dir", async () => {
        const root = path.join(os.tmpdir(), `ems-snap-write-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => durable,
        });
        const jobDir = layout.jobDir("job-snap-1");
        await fs.mkdir(jobDir, { recursive: true });
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(realisticFixtureSource(root));
        const result = await (0, write_js_1.writePlannerInputSnapshot)(jobDir, snap, {
            runtimeRootDir: layout.runtimePlannerDir,
            durableDataDir: durable,
        });
        strict_1.default.equal(path.basename(result.path), "input.json");
        strict_1.default.equal(result.inputRevision, snap.inputRevision);
        const disk = JSON.parse(await fs.readFile(result.path, "utf8"));
        strict_1.default.ok((0, validate_js_1.validatePlannerInputSnapshotV2)(disk));
    });
    (0, node_test_1.it)("rejects durable dataFolder paths", async () => {
        const root = path.join(os.tmpdir(), `ems-snap-durable-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(createMockSource());
        await strict_1.default.rejects(() => (0, write_js_1.writePlannerInputSnapshot)(path.join(durable, "planner", "jobs", "x"), snap, {
            runtimeRootDir: path.join(durable, "runtime"),
            durableDataDir: durable,
        }), /path outside allowed root|job path must not be under durable/i);
    });
    (0, node_test_1.it)("rejects traversal in job dir", async () => {
        const root = path.join(os.tmpdir(), `ems-snap-traversal-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => durable,
        });
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(createMockSource());
        await strict_1.default.rejects(() => (0, write_js_1.writePlannerInputSnapshot)(path.join(layout.runtimeJobsDir, "..", "..", "escape"), snap, {
            runtimeRootDir: layout.runtimePlannerDir,
            durableDataDir: durable,
        }), /path outside allowed root|invalid job|must not|traversal|within root/i);
    });
    (0, node_test_1.it)("rejects snapshots exceeding budget", async () => {
        const root = path.join(os.tmpdir(), `ems-snap-budget-${Date.now()}`);
        const durable = (0, paths_js_1.durableDataDirFromRoot)(root, 0);
        const layout = (0, paths_js_2.resolvePlannerPaths)({
            namespace: "ems.0",
            getAbsoluteInstanceDataDir: () => durable,
        });
        const jobDir = layout.jobDir("job-budget");
        await fs.mkdir(jobDir, { recursive: true });
        const snap = await (0, builder_js_1.buildPlannerInputSnapshot)(createMockSource());
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
        huge.inputRevision = (0, canonical_js_1.computeInputRevision)({ ...huge, inputRevision: "" });
        await strict_1.default.rejects(() => (0, write_js_1.writePlannerInputSnapshot)(jobDir, huge, {
            runtimeRootDir: layout.runtimePlannerDir,
            durableDataDir: durable,
        }), types_js_2.PlannerInputSnapshotBudgetError);
    });
});
