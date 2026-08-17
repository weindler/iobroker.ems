"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWallboxFeedbackStatusTerminal = exports.tickWallboxFeedback = exports.planWallboxSafeRestore = exports.faultCodeForFeedbackStatus = exports.clearWallboxFault = exports.raiseWallboxFault = exports.emptyWallboxFault = exports.canSafeRestoreWallbox = exports.grantWallboxOwnership = exports.emptyWallboxOwnership = exports.WALLBOX_LIVE_WRITE_RELEASED = exports.resolveWallboxRuntimePhase = exports.runWallboxLiveFoundation = exports.executeWallboxWrite = exports.wallboxFeedbackConfigFromAdapter = exports.countWallboxFeedbackExpectations = exports.normalizeWallboxFeedbackValue = exports.evaluateWallboxFeedback = exports.buildWallboxFeedbackContract = exports.buildWallboxWritePlan = exports.WB_CONTROL_MODEL = exports.hasEvccControlWriteMapping = exports.resolveWallboxControlModel = exports.metaFromObject = exports.resolveWallboxControlObjectMetas = exports.collectConfiguredControlTargetStateIds = exports.buildWallboxControlMappingSnapshot = exports.buildWallboxCommandCandidate = exports.runWallboxDryrunDispatch = exports.resetWallboxDispatchCache = exports.buildWallboxDispatchIntent = exports.telemetryInputFromSnapshot = exports.resolveWallboxDailyPlanDecision = exports.resetWallboxDailyPlanCache = exports.ensureWallboxRuntimeStates = exports.publishWallboxSafetyStates = exports.publishWallboxLiveFoundationStates = exports.publishWallboxDispatchStates = exports.publishWallboxRuntimeStates = void 0;
const state_write_1 = require("../../../policy/core/state_write");
const states_1 = require("./states");
const feedback_1 = require("./feedback");
async function publishWallboxRuntimeStates(host, decision, _governanceAllowed) {
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.decisionSource, decision.decisionSource);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.reasonDe, decision.reasonDe);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dailyPlanStatus, decision.dailyPlanStatus);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.dailyPlanRevision, decision.dailyPlanRevision ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.allocatedPowerW, decision.allocatedPowerW ?? 0);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.energySource, decision.energySource);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.writeAllowed, false);
}
exports.publishWallboxRuntimeStates = publishWallboxRuntimeStates;
async function publishWallboxDispatchStates(_host, _decision, _dispatch) {
    /* Dispatch-Details bleiben intern; öffentliche Runtime schreibt writeAllowed/detail_json. */
}
exports.publishWallboxDispatchStates = publishWallboxDispatchStates;
async function publishWallboxLiveFoundationStates(host, foundation) {
    const candidate = foundation.candidate;
    const plan = foundation.writePlan;
    const mapping = foundation.mappingSnapshot;
    const fb = foundation.feedbackContract;
    const fbCounts = fb ? (0, feedback_1.countWallboxFeedbackExpectations)(fb.expectations) : null;
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.executionBlockReason, foundation.writeResult?.reason ?? (foundation.phase === "dryrun" ? "execution_gate_closed" : ""));
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.writeLiveEligible, plan?.liveEligible ?? false);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.writeAllowed, foundation.writeAllowed);
    const detail = {
        phase: foundation.phase,
        liveWriteReleased: foundation.liveWriteReleased,
        commandCandidate: candidate,
        writeResult: foundation.writeResult,
        writePlan: plan,
        mapping: {
            controlModel: mapping.controlModel,
            legacyMappingsPresent: mapping.legacyMappingsPresent,
            evccMappingsPresent: mapping.evccMappingsPresent,
            missingRoles: mapping.missingRoles,
            validationIssues: mapping.validationIssues,
            controlContractModel: mapping.controlContractModel,
            evccControlContractReady: mapping.evccControlContractReady,
            legacyDirectControlPresent: mapping.legacyDirectControlPresent,
            evccModeControlVariant: mapping.evccModeControlVariant,
            evccModeFeedbackStateId: mapping.evccModeFeedbackStateId,
            evccModeButtonsReady: mapping.evccModeButtonsReady,
            evccModeButtonReady: mapping.evccModeButtonReady,
            activeContractInputs: mapping.activeContractInputs,
            ignoredLegacyConfig: mapping.ignoredLegacyConfig,
        },
        feedback: fb
            ? {
                required: fb.required,
                ready: fb.ready,
                status: fb.status,
                blockReason: fb.blockReason,
                issueKind: fb.issueKind,
                expectationCount: fb.expectations.length,
                counts: fbCounts,
                settleTimeMs: fb.settleTimeMs,
                timeoutMs: fb.timeoutMs,
            }
            : null,
    };
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.detailJson, JSON.stringify(detail));
}
exports.publishWallboxLiveFoundationStates = publishWallboxLiveFoundationStates;
async function publishWallboxSafetyStates(host, ownership, fault) {
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.ownershipActive, ownership.active);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.faultActive, fault.active);
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.faultCode, fault.code ?? "");
    await (0, state_write_1.setStateIfChanged)(host, states_1.WALLBOX_RUNTIME_STATES.faultMessage, fault.message ?? "");
}
exports.publishWallboxSafetyStates = publishWallboxSafetyStates;
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
var control_mapping_1 = require("./control_mapping");
Object.defineProperty(exports, "buildWallboxControlMappingSnapshot", { enumerable: true, get: function () { return control_mapping_1.buildWallboxControlMappingSnapshot; } });
Object.defineProperty(exports, "collectConfiguredControlTargetStateIds", { enumerable: true, get: function () { return control_mapping_1.collectConfiguredControlTargetStateIds; } });
var control_object_meta_1 = require("./control_object_meta");
Object.defineProperty(exports, "resolveWallboxControlObjectMetas", { enumerable: true, get: function () { return control_object_meta_1.resolveWallboxControlObjectMetas; } });
Object.defineProperty(exports, "metaFromObject", { enumerable: true, get: function () { return control_object_meta_1.metaFromObject; } });
var evcc_control_config_1 = require("../evcc_control_config");
Object.defineProperty(exports, "resolveWallboxControlModel", { enumerable: true, get: function () { return evcc_control_config_1.resolveWallboxControlModel; } });
Object.defineProperty(exports, "hasEvccControlWriteMapping", { enumerable: true, get: function () { return evcc_control_config_1.hasEvccControlWriteMapping; } });
Object.defineProperty(exports, "WB_CONTROL_MODEL", { enumerable: true, get: function () { return evcc_control_config_1.WB_CONTROL_MODEL; } });
var write_plan_1 = require("./write_plan");
Object.defineProperty(exports, "buildWallboxWritePlan", { enumerable: true, get: function () { return write_plan_1.buildWallboxWritePlan; } });
var feedback_2 = require("./feedback");
Object.defineProperty(exports, "buildWallboxFeedbackContract", { enumerable: true, get: function () { return feedback_2.buildWallboxFeedbackContract; } });
Object.defineProperty(exports, "evaluateWallboxFeedback", { enumerable: true, get: function () { return feedback_2.evaluateWallboxFeedback; } });
Object.defineProperty(exports, "normalizeWallboxFeedbackValue", { enumerable: true, get: function () { return feedback_2.normalizeWallboxFeedbackValue; } });
Object.defineProperty(exports, "countWallboxFeedbackExpectations", { enumerable: true, get: function () { return feedback_2.countWallboxFeedbackExpectations; } });
var feedback_config_1 = require("./feedback_config");
Object.defineProperty(exports, "wallboxFeedbackConfigFromAdapter", { enumerable: true, get: function () { return feedback_config_1.wallboxFeedbackConfigFromAdapter; } });
var execute_1 = require("./execute");
Object.defineProperty(exports, "executeWallboxWrite", { enumerable: true, get: function () { return execute_1.executeWallboxWrite; } });
Object.defineProperty(exports, "runWallboxLiveFoundation", { enumerable: true, get: function () { return execute_1.runWallboxLiveFoundation; } });
Object.defineProperty(exports, "resolveWallboxRuntimePhase", { enumerable: true, get: function () { return execute_1.resolveWallboxRuntimePhase; } });
Object.defineProperty(exports, "WALLBOX_LIVE_WRITE_RELEASED", { enumerable: true, get: function () { return execute_1.WALLBOX_LIVE_WRITE_RELEASED; } });
var ownership_1 = require("./ownership");
Object.defineProperty(exports, "emptyWallboxOwnership", { enumerable: true, get: function () { return ownership_1.emptyWallboxOwnership; } });
Object.defineProperty(exports, "grantWallboxOwnership", { enumerable: true, get: function () { return ownership_1.grantWallboxOwnership; } });
Object.defineProperty(exports, "canSafeRestoreWallbox", { enumerable: true, get: function () { return ownership_1.canSafeRestoreWallbox; } });
var fault_1 = require("./fault");
Object.defineProperty(exports, "emptyWallboxFault", { enumerable: true, get: function () { return fault_1.emptyWallboxFault; } });
Object.defineProperty(exports, "raiseWallboxFault", { enumerable: true, get: function () { return fault_1.raiseWallboxFault; } });
Object.defineProperty(exports, "clearWallboxFault", { enumerable: true, get: function () { return fault_1.clearWallboxFault; } });
Object.defineProperty(exports, "faultCodeForFeedbackStatus", { enumerable: true, get: function () { return fault_1.faultCodeForFeedbackStatus; } });
var restore_1 = require("./restore");
Object.defineProperty(exports, "planWallboxSafeRestore", { enumerable: true, get: function () { return restore_1.planWallboxSafeRestore; } });
var feedback_tick_1 = require("./feedback_tick");
Object.defineProperty(exports, "tickWallboxFeedback", { enumerable: true, get: function () { return feedback_tick_1.tickWallboxFeedback; } });
Object.defineProperty(exports, "isWallboxFeedbackStatusTerminal", { enumerable: true, get: function () { return feedback_tick_1.isWallboxFeedbackStatusTerminal; } });
