"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.governedRuntimeSurfaceEntries = exports.runtimeSurfaceStateMap = exports.addonRuntimeSurfaceState = exports.RUNTIME_SURFACE_STATE_IDS = exports.addonRuntimeSurfaceBase = void 0;
const registry_1 = require("../governance/registry");
/** Runtime path prefix: addons.<runtimeId>.runtime.surface */
function addonRuntimeSurfaceBase(runtimeAddonId) {
    return `addons.${runtimeAddonId}.runtime.surface`;
}
exports.addonRuntimeSurfaceBase = addonRuntimeSurfaceBase;
exports.RUNTIME_SURFACE_STATE_IDS = {
    decisionSource: "decision_source",
    decisionDetail: "decision_detail",
    decisionReason: "decision_reason",
    lastDecisionAt: "last_decision_at",
    plannerStatus: "planner_status",
    intentStatus: "intent_status",
    executionStatus: "execution_status",
    profileReady: "profile_ready",
    telemetryReady: "telemetry_ready",
    fault: "fault",
    lockout: "lockout",
};
function addonRuntimeSurfaceState(runtimeAddonId, key) {
    return `${addonRuntimeSurfaceBase(runtimeAddonId)}.${key}`;
}
exports.addonRuntimeSurfaceState = addonRuntimeSurfaceState;
function runtimeSurfaceStateMap(runtimeAddonId) {
    const base = addonRuntimeSurfaceBase(runtimeAddonId);
    return {
        decisionSource: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.decisionSource}`,
        decisionDetail: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.decisionDetail}`,
        decisionReason: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.decisionReason}`,
        lastDecisionAt: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.lastDecisionAt}`,
        plannerStatus: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.plannerStatus}`,
        intentStatus: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.intentStatus}`,
        executionStatus: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.executionStatus}`,
        profileReady: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.profileReady}`,
        telemetryReady: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.telemetryReady}`,
        fault: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.fault}`,
        lockout: `${base}.${exports.RUNTIME_SURFACE_STATE_IDS.lockout}`,
    };
}
exports.runtimeSurfaceStateMap = runtimeSurfaceStateMap;
function governedRuntimeSurfaceEntries() {
    return registry_1.GOVERNED_ADDON_REGISTRY;
}
exports.governedRuntimeSurfaceEntries = governedRuntimeSurfaceEntries;
