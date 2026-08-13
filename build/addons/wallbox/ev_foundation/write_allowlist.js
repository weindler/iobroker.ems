"use strict";
/**
 * Future EMS planner write allowlist (Phase 1: catalog only — not wired into execute).
 *
 * Existing live writes via wb_evcc_set_mode_target / maxCurrent / phase stay unchanged.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.encodePhasesConfiguredWrite = exports.encodePvControl = exports.EV_FOUNDATION_PLANNER_WRITES_ENABLED = exports.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED = exports.isPlannerWriteTaboo = exports.isFuturePlannerWriteAllowed = exports.classifyEvccPlannerWriteTarget = exports.EVCC_PLANNER_WRITE_TABOO_SUFFIXES = exports.EVCC_FUTURE_PLANNER_WRITE_SUFFIXES = exports.EVCC_PHASES_CONFIGURED_WRITE = exports.EVCC_PV_CONTROL = void 0;
exports.EVCC_PV_CONTROL = {
    off: 0,
    pv: 1,
    min: 2,
    now: 3,
};
exports.EVCC_PHASES_CONFIGURED_WRITE = {
    auto: 0,
    "1p": 1,
    "3p": 3,
};
/** Suffixes under evcc.*.loadpoint.*.control.* that a later planner may write. */
exports.EVCC_FUTURE_PLANNER_WRITE_SUFFIXES = [
    "control.off",
    "control.pv",
    "control.min",
    "control.now",
    "control.pvControl",
    "control.maxCurrent",
    "control.phasesConfigured",
];
/** Taboo for automatic planner writes (this phase and until explicitly enabled). */
exports.EVCC_PLANNER_WRITE_TABOO_SUFFIXES = [
    "control.limitSoc",
    "control.minCurrent",
    "control.enableThreshold",
    "control.disableThreshold",
    "control.smartCostLimit",
    "control.vehicleName",
];
function normalizedId(stateId) {
    return stateId.trim().replace(/\.+/g, ".").toLowerCase();
}
function matchesSuffix(stateId, suffix) {
    const id = normalizedId(stateId);
    const s = suffix.toLowerCase();
    return id.endsWith(`.${s}`) || id.endsWith(s);
}
function classifyEvccPlannerWriteTarget(stateId) {
    const id = stateId.trim();
    if (!id)
        return "other";
    if (exports.EVCC_PLANNER_WRITE_TABOO_SUFFIXES.some((s) => matchesSuffix(id, s))) {
        return "taboo";
    }
    if (exports.EVCC_FUTURE_PLANNER_WRITE_SUFFIXES.some((s) => matchesSuffix(id, s))) {
        return "allowed";
    }
    return "other";
}
exports.classifyEvccPlannerWriteTarget = classifyEvccPlannerWriteTarget;
function isFuturePlannerWriteAllowed(stateId) {
    return classifyEvccPlannerWriteTarget(stateId) === "allowed";
}
exports.isFuturePlannerWriteAllowed = isFuturePlannerWriteAllowed;
function isPlannerWriteTaboo(stateId) {
    return classifyEvccPlannerWriteTarget(stateId) === "taboo";
}
exports.isPlannerWriteTaboo = isPlannerWriteTaboo;
/** Phase 1+2: no new productive planner writes are issued. */
exports.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED = false;
exports.EV_FOUNDATION_PLANNER_WRITES_ENABLED = exports.EV_FOUNDATION_PHASE1_PLANNER_WRITES_ENABLED;
function encodePvControl(mode) {
    return exports.EVCC_PV_CONTROL[mode];
}
exports.encodePvControl = encodePvControl;
function encodePhasesConfiguredWrite(phases) {
    return exports.EVCC_PHASES_CONFIGURED_WRITE[phases];
}
exports.encodePhasesConfiguredWrite = encodePhasesConfiguredWrite;
