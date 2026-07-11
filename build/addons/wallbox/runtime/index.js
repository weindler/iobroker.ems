"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLBOX_LIVE_WRITE_RELEASED = exports.resolveWallboxRuntimePhase = exports.runWallboxLiveFoundation = exports.executeWallboxWrite = exports.buildWallboxCommandCandidate = exports.runWallboxDryrunDispatch = exports.resetWallboxDispatchCache = exports.buildWallboxDispatchIntent = exports.telemetryInputFromSnapshot = exports.resolveWallboxDailyPlanDecision = exports.resetWallboxDailyPlanCache = exports.ensureWallboxRuntimeStates = exports.publishWallboxLiveFoundationStates = exports.publishWallboxDispatchStates = exports.publishWallboxRuntimeStates = void 0;
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
async function publishWallboxDispatchStates(host, decision, dispatch) {
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchStatus, dispatch.dispatchStatus);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchReasonDe, dispatch.dispatchReasonDe);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchAction, dispatch.intent.action);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchIntentJson, JSON.stringify(dispatch.intent));
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchTargetJson, JSON.stringify(dispatch.target));
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.targetEnabled, dispatch.target.enableCharging);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.targetPowerW, dispatch.target.targetPowerW ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.targetCurrentA, dispatch.target.targetCurrentA ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.targetPhases, dispatch.target.phases ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.targetEvccMode, dispatch.target.desiredEvccMode ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchSource, decision.decisionSource);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchValidUntil, dispatch.intent.validUntil ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dispatchDailyPlanRevision, dispatch.intent.dailyPlanRevision ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.deadlineStatus, dispatch.deadlineStatus);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.deadlineRisk, dispatch.deadlineStatus === "at_risk");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.controlMappingComplete, dispatch.readiness.controlMappingComplete);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.controlMappingMissingJson, JSON.stringify(dispatch.readiness.missingMappings));
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dryrunCommandJson, JSON.stringify(dispatch.dryrunCommand));
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.writeAllowed, false);
}
exports.publishWallboxDispatchStates = publishWallboxDispatchStates;
async function publishWallboxLiveFoundationStates(host, foundation) {
    const candidate = foundation.candidate;
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.liveFoundationPhase, foundation.phase);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.liveWriteReleased, foundation.liveWriteReleased);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.commandCandidatePresent, candidate !== null);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.commandCandidateJson, candidate ? JSON.stringify(candidate) : "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.executionAttempted, foundation.writeResult?.attempted ?? false);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.executionExecuted, foundation.writeResult?.executed ?? false);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.executionBlockReason, foundation.writeResult?.reason ?? (foundation.phase === "dryrun" ? "execution_gate_closed" : ""));
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.runtimeControlAvailable, false);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.writeAllowed, false);
}
exports.publishWallboxLiveFoundationStates = publishWallboxLiveFoundationStates;
var ensure_states_1 = require("./ensure_states");
Object.defineProperty(exports, "ensureWallboxRuntimeStates", { enumerable: true, get: function () { return ensure_states_1.ensureWallboxRuntimeStates; } });
var daily_plan_1 = require("./daily_plan");
Object.defineProperty(exports, "resetWallboxDailyPlanCache", { enumerable: true, get: function () { return daily_plan_1.resetWallboxDailyPlanCache; } });
Object.defineProperty(exports, "resolveWallboxDailyPlanDecision", { enumerable: true, get: function () { return daily_plan_1.resolveWallboxDailyPlanDecision; } });
Object.defineProperty(exports, "telemetryInputFromSnapshot", { enumerable: true, get: function () { return daily_plan_1.telemetryInputFromSnapshot; } });
var intent_1 = require("./intent");
Object.defineProperty(exports, "buildWallboxDispatchIntent", { enumerable: true, get: function () { return intent_1.buildWallboxDispatchIntent; } });
var dispatch_1 = require("./dispatch");
Object.defineProperty(exports, "resetWallboxDispatchCache", { enumerable: true, get: function () { return dispatch_1.resetWallboxDispatchCache; } });
Object.defineProperty(exports, "runWallboxDryrunDispatch", { enumerable: true, get: function () { return dispatch_1.runWallboxDryrunDispatch; } });
var command_1 = require("./command");
Object.defineProperty(exports, "buildWallboxCommandCandidate", { enumerable: true, get: function () { return command_1.buildWallboxCommandCandidate; } });
var execute_1 = require("./execute");
Object.defineProperty(exports, "executeWallboxWrite", { enumerable: true, get: function () { return execute_1.executeWallboxWrite; } });
Object.defineProperty(exports, "runWallboxLiveFoundation", { enumerable: true, get: function () { return execute_1.runWallboxLiveFoundation; } });
Object.defineProperty(exports, "resolveWallboxRuntimePhase", { enumerable: true, get: function () { return execute_1.resolveWallboxRuntimePhase; } });
Object.defineProperty(exports, "WALLBOX_LIVE_WRITE_RELEASED", { enumerable: true, get: function () { return execute_1.WALLBOX_LIVE_WRITE_RELEASED; } });
