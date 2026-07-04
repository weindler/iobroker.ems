"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPlanner = exports.initPlanner = exports.deviceIntentFromPlannerDecision = exports.plannerModePolicyFromGlobalMode = exports.buildPlannerConstraints = exports.planBattery = exports.planThermal = exports.resetPlannerRevisionForTest = exports.runPlannerTick = exports.runPlanner = exports.readPlannerInputs = exports.readPlannerThermalStage = void 0;
const ensure_states_1 = require("./ensure_states");
const run_1 = require("./run");
var inputs_1 = require("./inputs");
Object.defineProperty(exports, "readPlannerThermalStage", { enumerable: true, get: function () { return inputs_1.readPlannerThermalStage; } });
Object.defineProperty(exports, "readPlannerInputs", { enumerable: true, get: function () { return inputs_1.readPlannerInputs; } });
var run_2 = require("./run");
Object.defineProperty(exports, "runPlanner", { enumerable: true, get: function () { return run_2.runPlanner; } });
Object.defineProperty(exports, "runPlannerTick", { enumerable: true, get: function () { return run_2.runPlannerTick; } });
Object.defineProperty(exports, "resetPlannerRevisionForTest", { enumerable: true, get: function () { return run_2.resetPlannerRevisionForTest; } });
var thermal_1 = require("./rules/thermal");
Object.defineProperty(exports, "planThermal", { enumerable: true, get: function () { return thermal_1.planThermal; } });
var battery_1 = require("./rules/battery");
Object.defineProperty(exports, "planBattery", { enumerable: true, get: function () { return battery_1.planBattery; } });
Object.defineProperty(exports, "buildPlannerConstraints", { enumerable: true, get: function () { return battery_1.buildPlannerConstraints; } });
var mode_policy_1 = require("./mode_policy");
Object.defineProperty(exports, "plannerModePolicyFromGlobalMode", { enumerable: true, get: function () { return mode_policy_1.plannerModePolicyFromGlobalMode; } });
var battery_bridge_1 = require("./battery_bridge");
Object.defineProperty(exports, "deviceIntentFromPlannerDecision", { enumerable: true, get: function () { return battery_bridge_1.deviceIntentFromPlannerDecision; } });
async function initPlanner(host) {
    await (0, ensure_states_1.ensurePlannerStates)(host);
    await (0, run_1.runPlannerTick)(host);
}
exports.initPlanner = initPlanner;
async function stopPlanner() {
    // stateless — nothing to tear down
}
exports.stopPlanner = stopPlanner;
