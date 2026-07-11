"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPlanner = exports.initPlanner = exports.batteryWinterPlanConfigFromAdapter = exports.readTibber15MinPriceSlots = exports.isNowInWinterChargeWindow = exports.planBatteryWinterPriceWindows = exports.dailyKwhFromHouseLoadForecast = exports.planBatteryWinter = exports.plannerModePolicyFromGlobalMode = exports.buildPlannerConstraints = exports.planBattery = exports.coolingReserveW = exports.planCooling = exports.resetPlannerRevisionForTest = exports.runPlannerTick = exports.runPlanner = exports.readPlannerInputs = exports.readPlannerThermalStage = void 0;
const ensure_states_1 = require("./ensure_states");
const grid_states_1 = require("../operator/supply/grid_states");
const run_1 = require("./run");
const grid_tick_1 = require("../operator/supply/grid_tick");
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
async function initPlanner(host) {
    await (0, ensure_states_1.ensurePlannerStates)(host);
    await (0, grid_states_1.ensureGridSupplyStates)(host);
    await (0, run_1.runPlannerTick)(host);
    await (0, grid_tick_1.runGridSupplyTick)(host);
}
exports.initPlanner = initPlanner;
async function stopPlanner() {
    // stateless — nothing to tear down
}
exports.stopPlanner = stopPlanner;
