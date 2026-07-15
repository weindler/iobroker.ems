"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writePlannerCoordinatorStatusStates = void 0;
const state_write_1 = require("../policy/core/state_write");
const canonical_1 = require("./canonical");
const ensure_states_1 = require("./ensure_states");
async function writePlannerCoordinatorStatusStates(host, status) {
    const active = status.state === "building_snapshot" ||
        status.state === "starting_worker" ||
        status.state === "worker_running" ||
        status.state === "validating_output";
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.state, status.state);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.active, active);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.activeJobId, status.activeJobId ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastTriggerReason, status.lastTriggerReason ?? status.activeReason ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastResult, status.lastResult ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastSkipReason, status.lastSkipReason ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastErrorCode, status.lastErrorCode ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastStartedAt, status.lastStartedAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastFinishedAt, status.lastFinishedAt ?? "");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastDurationMs, status.lastDurationMs ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastInputRevision, (0, canonical_1.shortenRevision)(status.lastInputRevision));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.lastPreparationRevision, (0, canonical_1.shortenRevision)(status.lastPreparationRevision));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.comparisonStatus, status.comparisonStatus ?? "not_available");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision, (0, canonical_1.shortenRevision)(status.comparisonReferenceRevision));
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.comparisonWorkerRevision, (0, canonical_1.shortenRevision)(status.comparisonWorkerRevision));
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchCount, status.comparisonMismatchCount ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.PLANNER_COORDINATOR_STATE_IDS.comparisonFirstMismatch, status.comparisonFirstMismatch ?? "");
}
exports.writePlannerCoordinatorStatusStates = writePlannerCoordinatorStatusStates;
