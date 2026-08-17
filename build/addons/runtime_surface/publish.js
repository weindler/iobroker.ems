"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishAddonRuntimeSurface = exports.buildAddonRuntimeSurfaceSnapshot = void 0;
const map_decision_1 = require("./map_decision");
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
/** Snapshot intern — keine ioBroker-Spiegel unter runtime.surface.*. */
async function publishAddonRuntimeSurface(_host, _runtimeAddonId, input) {
    return buildAddonRuntimeSurfaceSnapshot(input);
}
exports.publishAddonRuntimeSurface = publishAddonRuntimeSurface;
