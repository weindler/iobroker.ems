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
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPlanner = exports.initPlanner = exports.runPlannerRuntime = exports.ensurePlannerStateTree = exports.batteryWinterPlanConfigFromAdapter = exports.readTibber15MinPriceSlots = exports.isNowInWinterChargeWindow = exports.planBatteryWinterPriceWindows = exports.dailyKwhFromHouseLoadForecast = exports.planBatteryWinter = exports.plannerModePolicyFromGlobalMode = exports.buildPlannerConstraints = exports.planBattery = exports.coolingReserveW = exports.planCooling = exports.resetPlannerRevisionForTest = exports.runPlannerTick = exports.runPlanner = exports.readPlannerInputs = exports.readPlannerThermalStage = void 0;
const ensure_states_1 = require("./ensure_states");
const grid_states_1 = require("../operator/supply/grid_states");
const states_1 = require("../operator/forecast/states");
const states_2 = require("../operator/contributions/flexible/states");
const states_3 = require("../operator/daily_plan/states");
const ensure_states_2 = require("../planner_shadow/ensure_states");
const run_1 = require("./run");
var inputs_1 = require("./inputs");
Object.defineProperty(exports, "readPlannerThermalStage", { enumerable: true, get: function () { return inputs_1.readPlannerThermalStage; } });
Object.defineProperty(exports, "readPlannerInputs", { enumerable: true, get: function () { return inputs_1.readPlannerInputs; } });
var run_2 = require("./run");
Object.defineProperty(exports, "runPlanner", { enumerable: true, get: function () { return run_2.runPlanner; } });
Object.defineProperty(exports, "runPlannerTick", { enumerable: true, get: function () { return run_2.runPlannerTick; } });
Object.defineProperty(exports, "resetPlannerRevisionForTest", { enumerable: true, get: function () { return run_2.resetPlannerRevisionForTest; } });
var cooling_1 = require("./rules/cooling");
Object.defineProperty(exports, "planCooling", { enumerable: true, get: function () { return cooling_1.planCooling; } });
Object.defineProperty(exports, "coolingReserveW", { enumerable: true, get: function () { return cooling_1.coolingReserveW; } });
var battery_1 = require("./rules/battery");
Object.defineProperty(exports, "planBattery", { enumerable: true, get: function () { return battery_1.planBattery; } });
Object.defineProperty(exports, "buildPlannerConstraints", { enumerable: true, get: function () { return battery_1.buildPlannerConstraints; } });
var mode_policy_1 = require("./mode_policy");
Object.defineProperty(exports, "plannerModePolicyFromGlobalMode", { enumerable: true, get: function () { return mode_policy_1.plannerModePolicyFromGlobalMode; } });
var battery_winter_1 = require("./rules/battery_winter");
Object.defineProperty(exports, "planBatteryWinter", { enumerable: true, get: function () { return battery_winter_1.planBatteryWinter; } });
Object.defineProperty(exports, "dailyKwhFromHouseLoadForecast", { enumerable: true, get: function () { return battery_winter_1.dailyKwhFromHouseLoadForecast; } });
var battery_winter_windows_1 = require("./rules/battery_winter_windows");
Object.defineProperty(exports, "planBatteryWinterPriceWindows", { enumerable: true, get: function () { return battery_winter_windows_1.planBatteryWinterPriceWindows; } });
Object.defineProperty(exports, "isNowInWinterChargeWindow", { enumerable: true, get: function () { return battery_winter_windows_1.isNowInWinterChargeWindow; } });
var battery_winter_price_inputs_1 = require("./battery_winter_price_inputs");
Object.defineProperty(exports, "readTibber15MinPriceSlots", { enumerable: true, get: function () { return battery_winter_price_inputs_1.readTibber15MinPriceSlots; } });
var battery_winter_config_1 = require("./battery_winter_config");
Object.defineProperty(exports, "batteryWinterPlanConfigFromAdapter", { enumerable: true, get: function () { return battery_winter_config_1.batteryWinterPlanConfigFromAdapter; } });
/** Phase B — nur Objektbaum, keine Planner-Ticks. */
async function ensurePlannerStateTree(host, options) {
    await (0, ensure_states_1.ensurePlannerStates)(host, {
        includeThermal: options?.includeThermalIntent !== false,
        includeCooling: options?.includeCoolingIntent !== false,
        includeWinter: options?.includeWinterIntent !== false,
    });
    await (0, grid_states_1.ensureGridSupplyStates)(host);
    await (0, states_1.ensureForecastPlanStates)(host);
    await (0, states_2.ensureFlexibleContributionStates)(host);
    await (0, states_3.ensureDailyPlanStates)(host);
    if (options?.leanOperatorSurface) {
        return;
    }
    await (0, ensure_states_2.ensurePlannerCoordinatorStates)(host, { minimal: options?.coordinatorMinimal === true });
    if (options?.includeTakeoverStates !== false) {
        const { ensurePlannerTakeoverStates } = await Promise.resolve().then(() => __importStar(require("../planner_takeover/states.js")));
        await ensurePlannerTakeoverStates(host);
    }
}
exports.ensurePlannerStateTree = ensurePlannerStateTree;
/** Phase F — initiale Planner-Auswertung (Forecast / Daily / Allocation). */
async function runPlannerRuntime(host) {
    await (0, run_1.runPlannerTick)(host);
    const { runGridSupplyTick } = await Promise.resolve().then(() => __importStar(require("../operator/supply/grid_tick.js")));
    const { runFlexibleContributionsTick } = await Promise.resolve().then(() => __importStar(require("../operator/contributions/flexible/tick.js")));
    const { runForecastPlanTick } = await Promise.resolve().then(() => __importStar(require("../operator/forecast/tick.js")));
    const { runDailyPlanTick } = await Promise.resolve().then(() => __importStar(require("../operator/daily_plan/tick.js")));
    const gridForecast = await runGridSupplyTick(host);
    const flexibleContributions = await runFlexibleContributionsTick(host, gridForecast);
    const forecastPlan = await runForecastPlanTick(host, gridForecast, flexibleContributions);
    await runDailyPlanTick(host, forecastPlan);
}
exports.runPlannerRuntime = runPlannerRuntime;
async function initPlanner(host) {
    await ensurePlannerStateTree(host);
    await runPlannerRuntime(host);
}
exports.initPlanner = initPlanner;
async function stopPlanner() {
    // stateless — nothing to tear down
}
exports.stopPlanner = stopPlanner;
