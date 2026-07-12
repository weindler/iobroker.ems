"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPlanner = exports.initPlanner = exports.runPlannerRuntime = exports.ensurePlannerStateTree = exports.batteryWinterPlanConfigFromAdapter = exports.readTibber15MinPriceSlots = exports.isNowInWinterChargeWindow = exports.planBatteryWinterPriceWindows = exports.dailyKwhFromHouseLoadForecast = exports.planBatteryWinter = exports.plannerModePolicyFromGlobalMode = exports.buildPlannerConstraints = exports.planBattery = exports.coolingReserveW = exports.planCooling = exports.resetPlannerRevisionForTest = exports.runPlannerTick = exports.runPlanner = exports.readPlannerInputs = exports.readPlannerThermalStage = void 0;
const ensure_states_1 = require("./ensure_states");
const grid_states_1 = require("../operator/supply/grid_states");
const states_1 = require("../operator/forecast/states");
const states_2 = require("../operator/contributions/flexible/states");
const run_1 = require("./run");
const grid_tick_1 = require("../operator/supply/grid_tick");
const tick_1 = require("../operator/contributions/flexible/tick");
const tick_2 = require("../operator/forecast/tick");
const states_3 = require("../operator/daily_plan/states");
const tick_3 = require("../operator/daily_plan/tick");
const grid_1 = require("../operator/supply/grid");
const grid_read_1 = require("../operator/supply/grid_read");
const memory_inventory_1 = require("../diagnostics/memory_inventory");
const startup_memory_1 = require("../diagnostics/startup_memory");
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
function plannerProbe(log, checkpoint) {
    (0, startup_memory_1.probeStartupMemory)(log, checkpoint);
}
/** Phase B — nur Objektbaum, keine Planner-Ticks. */
async function ensurePlannerStateTree(host) {
    await (0, ensure_states_1.ensurePlannerStates)(host);
    await (0, grid_states_1.ensureGridSupplyStates)(host);
    await (0, states_1.ensureForecastPlanStates)(host);
    await (0, states_2.ensureFlexibleContributionStates)(host);
    await (0, states_3.ensureDailyPlanStates)(host);
}
exports.ensurePlannerStateTree = ensurePlannerStateTree;
/** Phase F — initiale Planner-Auswertung. */
async function runPlannerRuntime(host) {
    const log = host.log;
    const now = new Date();
    plannerProbe(log, "planner_runtime_start");
    plannerProbe(log, "planner_before_grid_collect");
    const gridInput = await (0, grid_read_1.collectGridSupplyBuildInput)(host, now);
    const gridForecast = (0, grid_1.buildGridSupplyForecast)(gridInput);
    const priceSlots = (0, grid_1.gridSlotsToPrice15Min)(gridForecast.slots);
    (0, memory_inventory_1.recordMemoryInventory)({
        module: "planner_grid_collect",
        checkpoint: "after_collect",
        arrayEntries: priceSlots.length,
        mapEntries: gridForecast.slots.length,
    });
    (0, memory_inventory_1.logMemoryInventory)(log, "planner_grid_collect", "after_collect");
    plannerProbe(log, "planner_after_grid_collect");
    plannerProbe(log, "planner_before_run_planner_tick");
    await (0, run_1.runPlannerTick)(host, { batteryWinterPriceSlots: priceSlots });
    plannerProbe(log, "planner_after_run_planner_tick");
    plannerProbe(log, "planner_before_grid_supply_write");
    await (0, grid_tick_1.runGridSupplyTick)(host, { forecast: gridForecast, input: gridInput });
    plannerProbe(log, "planner_after_grid_supply_write");
    plannerProbe(log, "planner_before_flexible_contributions");
    const flexibleContributions = await (0, tick_1.runFlexibleContributionsTick)(host, gridForecast);
    plannerProbe(log, "planner_after_flexible_contributions");
    plannerProbe(log, "planner_before_forecast_plan");
    const forecastPlan = await (0, tick_2.runForecastPlanTick)(host, gridForecast, flexibleContributions);
    (0, memory_inventory_1.recordMemoryInventory)({
        module: "planner_forecast_plan",
        checkpoint: "after_build",
        arrayEntries: forecastPlan.slots.length,
        recordsLoaded: forecastPlan.contributions.length,
    });
    (0, memory_inventory_1.logMemoryInventory)(log, "planner_forecast_plan", "after_build");
    plannerProbe(log, "planner_after_forecast_plan");
    plannerProbe(log, "planner_before_daily_plan");
    await (0, tick_3.runDailyPlanTick)(host, forecastPlan);
    plannerProbe(log, "planner_after_daily_plan");
    plannerProbe(log, "planner_runtime_done");
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
