"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishAddonRuntimeSurface = exports.buildAddonRuntimeSurfaceSnapshot = void 0;
const state_write_1 = require("../../policy/core/state_write");
const map_decision_1 = require("./map_decision");
const paths_1 = require("./paths");
function buildAddonRuntimeSurfaceSnapshot(input) {
    return {
        decisionSource: (0, map_decision_1.mapDecisionDetailToCanonical)(input.decisionDetail),
        decisionDetail: input.decisionDetail || "safe_default",
        decisionReason: input.decisionReason || "",
        lastDecisionAt: input.nowIso,
        plannerStatus: input.plannerStatus,
        intentStatus: input.intentStatus,
        executionStatus: input.executionStatus,
        profileReady: input.profileReady === true,
        telemetryReady: input.telemetryReady === true,
        fault: input.fault === true,
        lockout: input.lockout === true,
    };
}
exports.buildAddonRuntimeSurfaceSnapshot = buildAddonRuntimeSurfaceSnapshot;
/** Publish unified §10 surface — call at end of each addon tick (after detailed leaves). */
async function publishAddonRuntimeSurface(host, runtimeAddonId, input) {
    const snap = buildAddonRuntimeSurfaceSnapshot(input);
    const ids = (0, paths_1.runtimeSurfaceStateMap)(runtimeAddonId);
    await (0, state_write_1.setStateIfChanged)(host, ids.decisionSource, snap.decisionSource);
    await (0, state_write_1.setStateIfChanged)(host, ids.decisionDetail, snap.decisionDetail);
    await (0, state_write_1.setStateIfChanged)(host, ids.decisionReason, snap.decisionReason);
    await (0, state_write_1.setStateIfChanged)(host, ids.lastDecisionAt, snap.lastDecisionAt);
    await (0, state_write_1.setStateIfChanged)(host, ids.plannerStatus, snap.plannerStatus);
    await (0, state_write_1.setStateIfChanged)(host, ids.intentStatus, snap.intentStatus);
    await (0, state_write_1.setStateIfChanged)(host, ids.executionStatus, snap.executionStatus);
    await (0, state_write_1.setStateIfChanged)(host, ids.profileReady, snap.profileReady);
    await (0, state_write_1.setStateIfChanged)(host, ids.telemetryReady, snap.telemetryReady);
    await (0, state_write_1.setStateIfChanged)(host, ids.fault, snap.fault);
    await (0, state_write_1.setStateIfChanged)(host, ids.lockout, snap.lockout);
    return snap;
}
exports.publishAddonRuntimeSurface = publishAddonRuntimeSurface;
