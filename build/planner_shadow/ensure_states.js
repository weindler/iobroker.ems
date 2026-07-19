"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isPlannerCoordinatorState = exports.ensurePlannerCoordinatorStates = exports.PLANNER_COORDINATOR_STATE_PREFIX = exports.PLANNER_COORDINATOR_STATE_IDS = void 0;
const state_util_1 = require("../ems_light/state_util");
const expert_surface_1 = require("../ems_light/expert_surface");
exports.PLANNER_COORDINATOR_STATE_IDS = {
    shadowEnabled: "planner.coordinator.shadow_enabled",
    manualTrigger: "planner.coordinator.manual_trigger",
    manualForceTrigger: "planner.coordinator.manual_force_trigger",
    configuredMode: "planner.coordinator.configured_mode",
    effectiveMode: "planner.coordinator.effective_mode",
    state: "planner.coordinator.state",
    active: "planner.coordinator.active",
    activeJobId: "planner.coordinator.active_job_id",
    lastTriggerReason: "planner.coordinator.last_trigger_reason",
    lastTriggerClass: "planner.coordinator.last_trigger_class",
    lastCoalescedCount: "planner.coordinator.last_coalesced_count",
    lastAutoRequestAt: "planner.coordinator.last_auto_request_at",
    nextScheduledAt: "planner.coordinator.next_scheduled_at",
    triggerPending: "planner.coordinator.trigger_pending",
    lastResult: "planner.coordinator.last_result",
    lastSkipReason: "planner.coordinator.last_skip_reason",
    lastErrorCode: "planner.coordinator.last_error_code",
    lastErrorStage: "planner.coordinator.last_error_stage",
    lastErrorDetail: "planner.coordinator.last_error_detail",
    lastStartedAt: "planner.coordinator.last_started_at",
    lastFinishedAt: "planner.coordinator.last_finished_at",
    lastDurationMs: "planner.coordinator.last_duration_ms",
    lastInputRevision: "planner.coordinator.last_input_revision",
    lastPreparationRevision: "planner.coordinator.last_preparation_revision",
    candidateRevision: "planner.coordinator.candidate_revision",
    candidateValidation: "planner.coordinator.candidate_validation",
    comparisonStatus: "planner.coordinator.comparison_status",
    comparisonReferenceRevision: "planner.coordinator.comparison_reference_revision",
    comparisonWorkerRevision: "planner.coordinator.comparison_worker_revision",
    comparisonMismatchCount: "planner.coordinator.comparison_mismatch_count",
    comparisonFirstMismatch: "planner.coordinator.comparison_first_mismatch",
    comparisonFirstDomain: "planner.coordinator.comparison_first_domain",
    comparisonMismatchedSlots: "planner.coordinator.comparison_mismatched_slots",
};
exports.PLANNER_COORDINATOR_STATE_PREFIX = "planner.coordinator.";
function strState(id, name, def = "", write = false) {
    return {
        id,
        common: (0, expert_surface_1.withExpertCommon)({ name, type: "string", role: write ? "state" : "text", read: true, write, def }),
        defaultVal: def,
        setDefaultIfEmpty: !write,
        extendCommon: true,
    };
}
function numState(id, name, def = 0, write = false) {
    return {
        id,
        common: (0, expert_surface_1.withExpertCommon)({ name, type: "number", role: "value", read: true, write, def }),
        defaultVal: def,
        setDefaultIfEmpty: !write,
        extendCommon: true,
    };
}
function boolState(id, name, def = false, write = false, role = "state") {
    return {
        id,
        common: (0, expert_surface_1.withExpertCommon)({ name, type: "boolean", role, read: true, write, def }),
        defaultVal: def,
        setDefaultIfEmpty: !write,
        extendCommon: true,
    };
}
async function ensurePlannerCoordinatorStates(host, options) {
    await (0, state_util_1.ensureChannel)(host, "planner.coordinator", "Planner On-Demand Coordinator");
    const coreDefs = [
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.shadowEnabled, "Planner Shadow Session-Freigabe", false, true),
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.manualTrigger, "Planner Shadow manuell starten", false, true, "button"),
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.manualForceTrigger, "Planner Shadow manuell erzwingen", false, true, "button"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.configuredMode, "Planner Betriebsart (Konfiguration)", "off"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.effectiveMode, "Planner Betriebsart (effektiv)", "off"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.state, "Coordinator Zustand", "disabled"),
    ];
    if (options?.minimal) {
        await (0, state_util_1.ensureStates)(host, coreDefs);
        return;
    }
    const defs = [
        ...coreDefs,
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.active, "Coordinator aktiv", false),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.activeJobId, "Coordinator Job-ID"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastTriggerReason, "Coordinator letzter Trigger"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastTriggerClass, "Coordinator letzte Triggerklasse"),
        numState(exports.PLANNER_COORDINATOR_STATE_IDS.lastCoalescedCount, "Coordinator coalesced Trigger", 0),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastAutoRequestAt, "Coordinator letzter Auto-Request"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.nextScheduledAt, "Coordinator nächster Schedule"),
        boolState(exports.PLANNER_COORDINATOR_STATE_IDS.triggerPending, "Coordinator Trigger pending", false),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastResult, "Coordinator letztes Ergebnis"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastSkipReason, "Coordinator Skip-Grund"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastErrorCode, "Coordinator Fehlercode"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastErrorStage, "Coordinator Fehlerstufe"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastErrorDetail, "Coordinator Fehlerdetail"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastStartedAt, "Coordinator Start (ISO)"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastFinishedAt, "Coordinator Ende (ISO)"),
        numState(exports.PLANNER_COORDINATOR_STATE_IDS.lastDurationMs, "Coordinator Dauer ms", 0),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastInputRevision, "Coordinator Input-Revision"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.lastPreparationRevision, "Coordinator Preparation-Revision"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.candidateRevision, "Candidate-Revision"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.candidateValidation, "Candidate-Validation"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonStatus, "Shadow Vergleich Status", "not_available"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonReferenceRevision, "Shadow Referenz-Revision"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonWorkerRevision, "Shadow Worker-Revision"),
        numState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchCount, "Shadow Abweichungen", 0),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonFirstMismatch, "Shadow erste Abweichung"),
        strState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonFirstDomain, "Shadow erste Domäne"),
        numState(exports.PLANNER_COORDINATOR_STATE_IDS.comparisonMismatchedSlots, "Shadow abweichende Slots", 0),
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
