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
exports.handlePlannerShadowStateChange = exports.observePlannerTriggerStateChange = exports.getPlannerEffectiveModeForTest = exports.getPlannerConfiguredModeForTest = exports.isPlannerShadowEnabledForTest = exports.stopPlannerShadowRuntime = exports.initPlannerShadowRuntime = void 0;
const compose_1 = require("../planner_coordinator/compose");
const planner_config_1 = require("../planner_config");
const planner_trigger_1 = require("../planner_trigger");
const paths_1 = require("../planner_paths/paths");
const ensure_states_1 = require("./ensure_states");
const mode_1 = require("./mode");
const status_bridge_1 = require("./status_bridge");
const session_1 = require("../planner_takeover/session");
const state_write_1 = require("../policy/core/state_write");
const SUBSCRIBED_PATTERNS = [
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled,
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger,
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger,
];
const TAKEOVER_STATE_PREFIX = "planner.takeover.";
function isPlannerTakeoverStateId(relativeId) {
    return relativeId.startsWith(TAKEOVER_STATE_PREFIX);
}
let runtimeHost = null;
let statusUnsubscribe = null;
let sessionShadowEnabled = false;
let configuredMode = "off";
let configuredEvaluationMode = "disabled";
let unloadStopped = false;
let triggerSystem = null;
let authAuthorityRuntimesStarted = false;
function isConsciousButtonRequest(val, ack) {
    return val === true && ack !== true;
}
async function resetButton(host, stateId) {
    await host.setStateAsync(stateId, { val: false, ack: true });
}
async function setStateIfChangedSafe(host, id, val) {
    const cur = await host.getStateAsync(id);
    if (cur?.val === val && cur?.ack === true)
        return;
    await host.setStateAsync(id, { val, ack: true });
}
async function writeModeStates(host) {
    const effective = (0, mode_1.resolveEffectivePlannerMode)({
        config: { planner_runtime_mode: configuredMode },
        sessionShadowEnabled,
    });
    await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.configuredMode, effective.configuredMode);
    await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.effectiveMode, effective.effectiveMode);
    await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, sessionShadowEnabled);
    // Do not create/write takeover stubs while runtime mode is off (objects may not exist).
    if (effective.effectiveMode === "off") {
        return;
    }
    const observing = effective.effectiveMode === "shadow_auto" && configuredEvaluationMode === "observe";
    await setStateIfChangedSafe(host, "planner.takeover.configured_evaluation_mode", configuredEvaluationMode);
    await setStateIfChangedSafe(host, "planner.takeover.effective_evaluation_mode", observing ? "observe" : "disabled");
    if (!observing) {
        await setStateIfChangedSafe(host, "planner.takeover.state", "not_evaluated");
        await setStateIfChangedSafe(host, "planner.takeover.canonical_allowed", false);
        await setStateIfChangedSafe(host, "planner.takeover.would_be_eligible", false);
        await setStateIfChangedSafe(host, "planner.takeover.block_reason", effective.effectiveMode === "shadow_auto" ? "evaluation_disabled" : "runtime_mode_not_auto");
    }
}
async function applySessionAndCoordinator(host) {
    const effective = (0, mode_1.resolveEffectivePlannerMode)({
        config: { planner_runtime_mode: configuredMode },
        sessionShadowEnabled,
    });
    (0, session_1.configureDualRunSession)({
        plannerRuntimeMode: effective.effectiveMode,
        configuredEvaluationMode,
        stateHost: host,
    });
    // Keep auth/authority cores unloaded while native mode is off.
    if (effective.effectiveMode !== "off") {
        try {
            const { configureAuthorizationSession, getAuthorizationSession } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime_session.js")));
            const prev = getAuthorizationSession();
            const modeChanged = prev.runtimeMode !== effective.effectiveMode || prev.evaluationMode !== configuredEvaluationMode;
            configureAuthorizationSession({
                runtimeMode: effective.effectiveMode,
                evaluationMode: configuredEvaluationMode,
            });
            if (modeChanged && prev.service) {
                await prev.service.invalidate("mode_change");
                await prev.service.syncFromConfig();
            }
        }
        catch {
            // optional
        }
        try {
            const { configureAuthoritySession, getAuthoritySession } = await Promise.resolve().then(() => __importStar(require("../planner_authority/runtime_session.js")));
            configureAuthoritySession({
                runtimeMode: effective.effectiveMode,
                evaluationMode: configuredEvaluationMode,
            });
            const authorityChangedOff = effective.effectiveMode !== "shadow_auto" || configuredEvaluationMode !== "observe";
            const authoritySvc = getAuthoritySession().service;
            if (authorityChangedOff && authoritySvc) {
                await authoritySvc.fallback("mode_change");
            }
        }
        catch {
            // optional
        }
    }
    await (0, compose_1.setPlannerOnDemandCoordinatorEnabled)(effective.coordinatorEnabled);
    await writeModeStates(host);
}
async function onCoordinatorStatus(status) {
    const host = runtimeHost;
    if (!host || unloadStopped)
        return;
    const diag = triggerSystem?.getDiagnostics();
    await (0, status_bridge_1.writePlannerCoordinatorStatusStates)(host, status, diag);
    try {
        const { configureAuthorizationSession, getAuthorizationSession } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime_session.js")));
        const jobActive = Boolean(status.activeJobId);
        const pending = status.rerunPending === true;
        configureAuthorizationSession({
            plannerJobActive: jobActive,
            pendingRerun: pending,
        });
        const auth = getAuthorizationSession().service;
        if (auth && (jobActive || pending)) {
            await auth.invalidate(jobActive ? "planner_job_active" : "pending_rerun");
        }
    }
    catch {
        // optional
    }
}
function mapAggregatedToCoordinatorReason(req) {
    if (req.reasonCode === "manual" || req.reasonCode === "manual_force")
        return "manual";
    if (req.reasonCode === "startup")
        return "startup_recovery";
    if (req.reasonCode.startsWith("schedule_"))
        return "scheduled";
    return "relevant_change";
}
async function onAggregatedTrigger(req) {
    if (unloadStopped)
        return;
    const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
    if (!coordinator)
        return;
    const host = runtimeHost;
    if (host) {
        await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastTriggerClass, req.primaryClass);
        await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastCoalescedCount, req.coalescedCount);
        await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastAutoRequestAt, req.lastObservedAt);
        const diag = triggerSystem?.getDiagnostics();
        if (diag?.nextScheduledAt) {
            await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.nextScheduledAt, diag.nextScheduledAt);
        }
        await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.triggerPending, false);
    }
    await coordinator.request({
        reason: mapAggregatedToCoordinatorReason(req),
        requestedAt: req.lastObservedAt,
        force: req.force,
    });
    try {
        const { getAuthorizationSession } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime_session.js")));
        const auth = getAuthorizationSession().service;
        if (auth)
            await auth.invalidate("planner_trigger");
    }
    catch {
        // optional
    }
}
async function initPlannerShadowRuntime(host) {
    runtimeHost = host;
    unloadStopped = false;
    const parsed = (0, planner_config_1.plannerRuntimeModeFromConfig)(host.config);
    configuredMode = parsed.mode;
    if (parsed.clamped) {
        host.log.warn(`planner_runtime_mode invalid — clamped to off (raw=${String(parsed.raw)})`);
    }
    const evalParsed = (0, planner_config_1.plannerTakeoverEvaluationModeFromConfig)(host.config);
    configuredEvaluationMode = evalParsed.mode;
    if (evalParsed.clamped) {
        host.log.warn(`planner_takeover_evaluation_mode invalid — clamped to disabled (raw=${String(evalParsed.raw)})`);
    }
    // Discard any persisted session grant; arm only from native mode.
    sessionShadowEnabled = (0, mode_1.initialSessionShadowFromNative)(configuredMode);
    // Central EMS paths — never call a non-existent adapter.getAbsoluteInstanceDataDir().
    const layout = (0, paths_1.resolvePlannerPaths)(host.pathInput ?? host);
    const effectiveMode = (0, mode_1.resolveEffectivePlannerMode)({
        config: { planner_runtime_mode: configuredMode },
        sessionShadowEnabled,
    }).effectiveMode;
    (0, session_1.configureDualRunSession)({
        layout,
        plannerRuntimeMode: effectiveMode,
        configuredEvaluationMode,
        stateHost: host,
        shuttingDown: false,
    });
    if (effectiveMode !== "off") {
        const { ensurePlannerCoordinatorStates } = await Promise.resolve().then(() => __importStar(require("./ensure_states.js")));
        await ensurePlannerCoordinatorStates(host, { minimal: false });
        const { ensurePlannerTakeoverStates } = await Promise.resolve().then(() => __importStar(require("../planner_takeover/states.js")));
        await ensurePlannerTakeoverStates(host);
    }
    await applySessionAndCoordinator(host);
    triggerSystem?.stop();
    triggerSystem = new planner_trigger_1.PlannerTriggerSystem({
        mode: (0, mode_1.resolveEffectivePlannerMode)({
            config: { planner_runtime_mode: configuredMode },
            sessionShadowEnabled,
        }).effectiveMode,
        onRequest: (req) => {
            void onAggregatedTrigger(req).catch((e) => {
                host.log.warn(`planner trigger request: ${String(e)}`);
            });
        },
        enableStartupTrigger: true,
    });
    triggerSystem.start();
    const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
    if (coordinator) {
        statusUnsubscribe?.();
        statusUnsubscribe = coordinator.subscribeStatus((status) => {
            void onCoordinatorStatus(status).catch((e) => {
                host.log.warn(`planner shadow status write: ${String(e)}`);
            });
        });
        await (0, status_bridge_1.writePlannerCoordinatorStatusStates)(host, coordinator.getStatus(), triggerSystem.getDiagnostics());
    }
    if (typeof host.subscribeStatesAsync === "function") {
        for (const pattern of SUBSCRIBED_PATTERNS) {
            await host.subscribeStatesAsync(pattern);
        }
    }
    if (effectiveMode !== "off") {
        const { initPlannerAuthorizationRuntime } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime.js")));
        await initPlannerAuthorizationRuntime(host);
        const { initPlannerAuthorityRuntime } = await Promise.resolve().then(() => __importStar(require("../planner_authority/runtime.js")));
        await initPlannerAuthorityRuntime(host);
        authAuthorityRuntimesStarted = true;
    }
}
exports.initPlannerShadowRuntime = initPlannerShadowRuntime;
async function stopPlannerShadowRuntime() {
    unloadStopped = true;
    (0, session_1.configureDualRunSession)({ shuttingDown: true });
    if (authAuthorityRuntimesStarted) {
        try {
            // Authority first — revoke worker authority back to legacy before authorization stops.
            const { stopPlannerAuthorityRuntime } = await Promise.resolve().then(() => __importStar(require("../planner_authority/runtime.js")));
            await stopPlannerAuthorityRuntime();
        }
        catch {
            // optional
        }
        try {
            const { stopPlannerAuthorizationRuntime } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime.js")));
            await stopPlannerAuthorizationRuntime();
        }
        catch {
            // optional
        }
        authAuthorityRuntimesStarted = false;
    }
    triggerSystem?.stop();
    triggerSystem = null;
    const host = runtimeHost;
    if (host && typeof host.unsubscribeStatesAsync === "function") {
        for (const pattern of SUBSCRIBED_PATTERNS) {
            await host.unsubscribeStatesAsync(pattern).catch(() => undefined);
        }
    }
    statusUnsubscribe?.();
    statusUnsubscribe = null;
    await (0, compose_1.setPlannerOnDemandCoordinatorEnabled)(false);
    sessionShadowEnabled = false;
    (0, session_1.configureDualRunSession)({ stateHost: null, plannerRuntimeMode: "off" });
    runtimeHost = null;
}
exports.stopPlannerShadowRuntime = stopPlannerShadowRuntime;
function isPlannerShadowEnabledForTest() {
    return sessionShadowEnabled;
}
exports.isPlannerShadowEnabledForTest = isPlannerShadowEnabledForTest;
function getPlannerConfiguredModeForTest() {
    return configuredMode;
}
exports.getPlannerConfiguredModeForTest = getPlannerConfiguredModeForTest;
function getPlannerEffectiveModeForTest() {
    return (0, mode_1.resolveEffectivePlannerMode)({
        config: { planner_runtime_mode: configuredMode },
        sessionShadowEnabled,
    }).effectiveMode;
}
exports.getPlannerEffectiveModeForTest = getPlannerEffectiveModeForTest;
/**
 * Observe non-coordinator state changes for auto triggers (shadow_auto only).
 * Lightweight — catalog match only; heavy modules stay unloaded.
 */
function observePlannerTriggerStateChange(relativeId, ack) {
    if (unloadStopped || !triggerSystem)
        return false;
    if ((0, ensure_states_1.isPlannerCoordinatorState)(relativeId))
        return false;
    if (isPlannerTakeoverStateId(relativeId))
        return false;
    return triggerSystem.observeStateChange(relativeId, ack);
}
exports.observePlannerTriggerStateChange = observePlannerTriggerStateChange;
async function handlePlannerShadowStateChange(host, relativeId, val, ack) {
    if (relativeId.startsWith("planner.takeover.authorization.")) {
        const { handlePlannerAuthorizationRuntimeStateChange } = await Promise.resolve().then(() => __importStar(require("../planner_authorization/runtime.js")));
        return handlePlannerAuthorizationRuntimeStateChange(host, relativeId, val, ack);
    }
    if (relativeId.startsWith("planner.authority.") ||
        relativeId === "planner.takeover.activate_worker_dryrun" ||
        relativeId === "planner.takeover.deactivate_worker") {
        const { handlePlannerAuthorityRuntimeStateChange } = await Promise.resolve().then(() => __importStar(require("../planner_authority/runtime.js")));
        return handlePlannerAuthorityRuntimeStateChange(host, relativeId, val, ack);
    }
    if (!(0, ensure_states_1.isPlannerCoordinatorState)(relativeId)) {
        return false;
    }
    if (unloadStopped) {
        return true;
    }
    if (relativeId === ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled) {
        if (ack === true)
            return true;
        // Session override only — never writes native config.
        // Cannot elevate above native off.
        const requested = val === true;
        if (configuredMode === "off") {
            sessionShadowEnabled = false;
            await applySessionAndCoordinator(host);
            host.log.debug?.("planner shadow session ignored — native mode is off");
            return true;
        }
        sessionShadowEnabled = requested;
        await applySessionAndCoordinator(host);
        return true;
    }
    if (relativeId === ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger) {
        if (!isConsciousButtonRequest(val, ack))
            return true;
        await resetButton(host, relativeId);
        const effective = (0, mode_1.resolveEffectivePlannerMode)({
            config: { planner_runtime_mode: configuredMode },
            sessionShadowEnabled,
        });
        if (!effective.allowsManual) {
            const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
            if (coordinator) {
                await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: false });
            }
            return true;
        }
        triggerSystem?.requestManual(false);
        return true;
    }
    if (relativeId === ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger) {
        if (!isConsciousButtonRequest(val, ack))
            return true;
        await resetButton(host, relativeId);
        const effective = (0, mode_1.resolveEffectivePlannerMode)({
            config: { planner_runtime_mode: configuredMode },
            sessionShadowEnabled,
        });
        if (!effective.allowsManual) {
            const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
            if (coordinator) {
                await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
            }
            return true;
        }
        triggerSystem?.requestManual(true);
        return true;
    }
    return true;
}
exports.handlePlannerShadowStateChange = handlePlannerShadowStateChange;
