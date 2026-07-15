"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlannerShadowStateChange = exports.isPlannerShadowEnabledForTest = exports.stopPlannerShadowRuntime = exports.initPlannerShadowRuntime = void 0;
const compose_1 = require("../planner_coordinator/compose");
const ensure_states_1 = require("./ensure_states");
const status_bridge_1 = require("./status_bridge");
const SUBSCRIBED_PATTERNS = [
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled,
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger,
    ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger,
];
let runtimeHost = null;
let statusUnsubscribe = null;
let shadowEnabled = false;
let unloadStopped = false;
function isConsciousButtonRequest(val, ack) {
    return val === true && ack !== true;
}
async function resetButton(host, stateId) {
    await host.setStateAsync(stateId, { val: false, ack: true });
}
async function applyShadowEnabled(host, enabled) {
    shadowEnabled = enabled;
    await (0, compose_1.setPlannerOnDemandCoordinatorEnabled)(enabled);
    if (enabled) {
        await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, true);
    }
    else {
        await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, false);
    }
}
async function setStateIfChangedSafe(host, id, val) {
    const cur = await host.getStateAsync(id);
    if (cur?.val === val && cur?.ack === true)
        return;
    await host.setStateAsync(id, { val, ack: true });
}
async function onCoordinatorStatus(status) {
    const host = runtimeHost;
    if (!host || unloadStopped)
        return;
    await (0, status_bridge_1.writePlannerCoordinatorStatusStates)(host, status);
}
async function requestManualTrigger(force) {
    const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
    if (!coordinator)
        return;
    await coordinator.request({
        reason: "manual",
        requestedAt: new Date().toISOString(),
        force,
    });
}
async function initPlannerShadowRuntime(host) {
    runtimeHost = host;
    unloadStopped = false;
    shadowEnabled = false;
    await (0, compose_1.setPlannerOnDemandCoordinatorEnabled)(false);
    await setStateIfChangedSafe(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, false);
    const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
    if (coordinator) {
        statusUnsubscribe?.();
        statusUnsubscribe = coordinator.subscribeStatus((status) => {
            void onCoordinatorStatus(status).catch((e) => {
                host.log.warn(`planner shadow status write: ${String(e)}`);
            });
        });
        await (0, status_bridge_1.writePlannerCoordinatorStatusStates)(host, coordinator.getStatus());
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
    const host = runtimeHost;
    if (host && typeof host.unsubscribeStatesAsync === "function") {
        for (const pattern of SUBSCRIBED_PATTERNS) {
            await host.unsubscribeStatesAsync(pattern).catch(() => undefined);
        }
    }
    statusUnsubscribe?.();
    statusUnsubscribe = null;
    await (0, compose_1.setPlannerOnDemandCoordinatorEnabled)(false);
    shadowEnabled = false;
    runtimeHost = null;
}
exports.stopPlannerShadowRuntime = stopPlannerShadowRuntime;
function isPlannerShadowEnabledForTest() {
    return shadowEnabled;
}
exports.isPlannerShadowEnabledForTest = isPlannerShadowEnabledForTest;
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
        const enabled = val === true;
        await applyShadowEnabled(host, enabled);
        return true;
    }
    if (relativeId === ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualTrigger) {
        if (!isConsciousButtonRequest(val, ack))
            return true;
        await resetButton(host, relativeId);
        if (!shadowEnabled) {
            const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
            if (coordinator) {
                await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: false });
            }
            return true;
        }
        await requestManualTrigger(false);
        return true;
    }
    if (relativeId === ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger) {
        if (!isConsciousButtonRequest(val, ack))
            return true;
        await resetButton(host, relativeId);
        if (!shadowEnabled) {
            const coordinator = (0, compose_1.getPlannerOnDemandCoordinator)();
            if (coordinator) {
                await coordinator.request({ reason: "manual", requestedAt: new Date().toISOString(), force: true });
            }
            return true;
        }
        await requestManualTrigger(true);
        return true;
    }
    return true;
}
exports.handlePlannerShadowStateChange = handlePlannerShadowStateChange;
