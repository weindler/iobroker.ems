"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveWallboxDailyPlanDecision = exports.resetWallboxDailyPlanCache = exports.ensureWallboxRuntimeStates = exports.publishWallboxRuntimeStates = void 0;
const state_write_1 = require("../../../policy/core/state_write");
const states_1 = require("./states");
async function publishWallboxRuntimeStates(host, decision, governanceAllowed) {
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.decisionSource, decision.decisionSource);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.reasonDe, decision.reasonDe);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dailyPlanStatus, decision.dailyPlanStatus);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dailyPlanValid, decision.planValid);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dailyPlanRevision, decision.dailyPlanRevision ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dailyPlanSlotStart, decision.slotStartIso ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dailyPlanSlotEnd, decision.slotEndIso ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.connected, decision.connected);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.chargingAllowedByPlan, decision.chargingAllowedByPlan);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.allocatedPowerW, decision.allocatedPowerW ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.allocatedEnergyKwh, decision.allocatedEnergyKwh ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.allocatedPvPowerW, decision.pvPowerW ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.allocatedGridPowerW, decision.gridPowerW ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.energySource, decision.energySource);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.deadlineIso, decision.deadlineIso ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.remainingEnergyKwh, decision.remainingEnergyKwh ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.plannedEnergyUntilDeadlineKwh, decision.plannedEnergyUntilDeadlineKwh);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.plannedPvEnergyUntilDeadlineKwh, decision.plannedPvEnergyUntilDeadlineKwh);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.plannedGridEnergyUntilDeadlineKwh, decision.plannedGridEnergyUntilDeadlineKwh);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.plannedCostUntilDeadlineCt, decision.plannedCostUntilDeadlineCt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.deadlineReachable, decision.deadlineReachable === null
        ? "unknown"
        : decision.deadlineReachable
            ? "true"
            : "false");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.firstPlannedSlot, decision.firstPlannedSlot ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.lastPlannedSlot, decision.lastPlannedSlot ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.activePlannedSlots, decision.activePlannedSlots);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.maxPlannedPowerW, decision.maxPlannedPowerW);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.minChargePowerW, decision.minChargePowerW ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.maxChargePowerW, decision.maxChargePowerW ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.planExecutionStatus, decision.planExecutionStatus);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.externalPlanActive, decision.externalPlanActive);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.externalPlanTime, decision.externalPlanTime ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.governanceAllowed, governanceAllowed);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.writeAllowed, false);
}
exports.publishWallboxRuntimeStates = publishWallboxRuntimeStates;
var ensure_states_1 = require("./ensure_states");
Object.defineProperty(exports, "ensureWallboxRuntimeStates", { enumerable: true, get: function () { return ensure_states_1.ensureWallboxRuntimeStates; } });
var daily_plan_1 = require("./daily_plan");
Object.defineProperty(exports, "resetWallboxDailyPlanCache", { enumerable: true, get: function () { return daily_plan_1.resetWallboxDailyPlanCache; } });
Object.defineProperty(exports, "resolveWallboxDailyPlanDecision", { enumerable: true, get: function () { return daily_plan_1.resolveWallboxDailyPlanDecision; } });
