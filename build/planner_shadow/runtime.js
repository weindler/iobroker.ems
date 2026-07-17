"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlannerShadowStateChange = exports.observePlannerTriggerStateChange = exports.getPlannerEffectiveModeForTest = exports.getPlannerConfiguredModeForTest = exports.isPlannerShadowEnabledForTest = exports.stopPlannerShadowRuntime = exports.initPlannerShadowRuntime = void 0;
const compose_1 = require("../planner_coordinator/compose");
const planner_config_1 = require("../planner_config");
const planner_trigger_1 = require("../planner_trigger");
const ensure_states_1 = require("./ensure_states");
const mode_1 = require("./mode");
const status_bridge_1 = require("./status_bridge");
const SUBSCRIBED_PATTERNS = [
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled,
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger,
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger,
];
let runtimeHost = null;
let statusUnsubscribe = null;
let sessionShadowEnabled = false;
let configuredMode = "off";
let unloadStopped = false;
let triggerSystem = null;
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
}
async function applySessionAndCoordinator(host) {
    const effective = (0, mode_1.resolveEffectivePlannerMode)({
        config: { planner_runtime_mode: configuredMode },
        sessionShadowEnabled,
    });
    await (0, compose_1.setPlannerOnDemandCoordinatorEnabled)(effective.coordinatorEnabled);
    await writeModeStates(host);
}
async function onCoordinatorStatus(status) {
    const host = runtimeHost;
    if (!host || unloadStopped)
        return;
    const diag = triggerSystem?.getDiagnostics();
    await (0, status_bridge_1.writePlannerCoordinatorStatusStates)(host, status, diag);
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
        await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastCoalescedCount, req.coalescedCount);
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
}
async function initPlannerShadowRuntime(host) {
    runtimeHost = host;
    unloadStopped = false;
    const parsed = (0, planner_config_1.plannerRuntimeModeFromConfig)(host.config);
    configuredMode = parsed.mode;
    if (parsed.clamped) {
        host.log.warn(`planner_runtime_mode invalid — clamped to off (raw=${String(parsed.raw)})`);
    }
    // Discard any persisted session grant; arm only from native mode.
    sessionShadowEnabled = (0, mode_1.initialSessionShadowFromNative)(configuredMode);
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
}
exports.initPlannerShadowRuntime = initPlannerShadowRuntime;
async function stopPlannerShadowRuntime() {
    unloadStopped = true;
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
    return triggerSystem.observeStateChange(relativeId, ack);
}
exports.observePlannerTriggerStateChange = observePlannerTriggerStateChange;
async function handlePlannerShadowStateChange(host, relativeId, val, ack) {
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
