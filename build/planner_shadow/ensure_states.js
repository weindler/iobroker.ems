"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlannerCoordinatorState = exports.ensurePlannerCoordinatorStates = exports.PLANNER_COORDINATOR_STATE_PREFIX = exports.PLANNER_COORDINATOR_STATE_IDS = void 0;
const state_util_1 = require("../ems_light/state_util");
exports.PLANNER_COORDINATOR_STATE_IDS = {
    shadowEnabled: "planner.coordinator.shadow_enabled",
    manualTrigger: "planner.coordinator.manual_trigger",
    manualForceTrigger: "planner.coordinator.manual_force_trigger",
    state: "planner.coordinator.state",
    active: "planner.coordinator.active",
    activeJobId: "planner.coordinator.active_job_id",
    lastTriggerReason: "planner.coordinator.last_trigger_reason",
    lastResult: "planner.coordinator.last_result",
    lastSkipReason: "planner.coordinator.last_skip_reason",
    lastErrorCode: "planner.coordinator.last_error_code",
    lastStartedAt: "planner.coordinator.last_started_at",
    lastFinishedAt: "planner.coordinator.last_finished_at",
    lastDurationMs: "planner.coordinator.last_duration_ms",
    lastInputRevision: "planner.coordinator.last_input_revision",
    lastPreparationRevision: "planner.coordinator.last_preparation_revision",
    comparisonStatus: "planner.coordinator.comparison_status",
    comparisonReferenceRevision: "planner.coordinator.comparison_reference_revision",
    comparisonWorkerRevision: "planner.coordinator.comparison_worker_revision",
    comparisonMismatchCount: "planner.coordinator.comparison_mismatch_count",
    comparisonFirstMismatch: "planner.coordinator.comparison_first_mismatch",
};
exports.PLANNER_COORDINATOR_STATE_PREFIX = "planner.coordinator.";
function strState(id, name, def = "", write = false) {
    return {
        id,
        common: { name, type: "string", role: write ? "state" : "text", read: true, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
    };
}
function numState(id, name, def = 0, write = false) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
    };
}
function boolState(id, name, def = false, write = false, role = "state") {
    return {
        id,
        common: { name, type: "boolean", role, read: true, write, def },
        defaultVal: def,
        setDefaultIfEmpty: !write,
    };
}
async function ensurePlannerCoordinatorStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner.coordinator", "Planner On-Demand Coordinator");
    const defs = [
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, "Planner Shadow aktiviert", false, true),
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, "Planner Shadow manuell starten", false, true, "button"),
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger, "Planner Shadow manuell erzwingen", false, true, "button"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.state, "Coordinator Zustand", "disabled"),
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.active, "Coordinator aktiv", false),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.activeJobId, "Coordinator Job-ID"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastTriggerReason, "Coordinator letzter Trigger"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastResult, "Coordinator letztes Ergebnis"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastSkipReason, "Coordinator Skip-Grund"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastErrorCode, "Coordinator Fehlercode"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastStartedAt, "Coordinator Start (ISO)"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastFinishedAt, "Coordinator Ende (ISO)"),
        numState(exports.PLANNER_COORDINATOR_STATE_IDS.lastDurationMs, "Coordinator Dauer ms", 0),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastInputRevision, "Coordinator Input-Revision"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastPreparationRevision, "Coordinator Preparation-Revision"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonStatus, "Shadow Vergleich Status", "not_available"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision, "Shadow Referenz-Revision"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonWorkerRevision, "Shadow Worker-Revision"),
        numState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchCount, "Shadow Abweichungen", 0),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonFirstMismatch, "Shadow erste Abweichung"),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerCoordinatorStates = ensurePlannerCoordinatorStates;
function isPlannerCoordinatorState(relativeId) {
    return relativeId === exports.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled ||
        relativeId === exports.PLANNER_COORDINATOR_STATE_IDS.manualTrigger ||
        relativeId === exports.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger ||
        relativeId.startsWith(exports.PLANNER_COORDINATOR_STATE_PREFIX);
}
exports.isPlannerCoordinatorState = isPlannerCoordinatorState;
