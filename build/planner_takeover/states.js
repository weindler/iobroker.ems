"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writePlannerTakeoverStates = exports.isPlannerTakeoverState = exports.ensurePlannerTakeoverStates = exports.PLANNER_TAKEOVER_STATE_PREFIX = exports.PLANNER_TAKEOVER_STATE_IDS = void 0;
const state_util_1 = require("../ems_light/state_util");
const state_write_1 = require("../policy/core/state_write");
const canonical_1 = require("../planner_shadow/canonical");
exports.PLANNER_TAKEOVER_STATE_IDS = {
    configuredEvaluationMode: "planner.takeover.configured_evaluation_mode",
    effectiveEvaluationMode: "planner.takeover.effective_evaluation_mode",
    state: "planner.takeover.state",
    blockReason: "planner.takeover.block_reason",
    eligibleRuns: "planner.takeover.eligible_runs",
    matchedRuns: "planner.takeover.matched_runs",
    mismatchedRuns: "planner.takeover.mismatched_runs",
    failedRuns: "planner.takeover.failed_runs",
    incomparableRuns: "planner.takeover.incomparable_runs",
    consecutiveMatches: "planner.takeover.consecutive_matches",
    observationStartedAt: "planner.takeover.observation_started_at",
    lastEligibleRunAt: "planner.takeover.last_eligible_run_at",
    lastMismatchAt: "planner.takeover.last_mismatch_at",
    lastFailureAt: "planner.takeover.last_failure_at",
    distinctUtcDays: "planner.takeover.distinct_utc_days",
    slotTransitions: "planner.takeover.slot_transitions",
    dayTransitions: "planner.takeover.day_transitions",
    authoritativeRevision: "planner.takeover.authoritative_revision",
    candidateRevision: "planner.takeover.candidate_revision",
    evidenceRevision: "planner.takeover.evidence_revision",
    wouldBeEligible: "planner.takeover.would_be_eligible",
    canonicalAllowed: "planner.takeover.canonical_allowed",
};
exports.PLANNER_TAKEOVER_STATE_PREFIX = "planner.takeover.";
function strState(id, name, def = "") {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function numState(id, name, def = 0) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function boolState(id, name, def = false) {
    return {
        id,
        common: { name, type: "boolean", role: "state", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
async function ensurePlannerTakeoverStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner.takeover", "Planner Takeover Evaluation");
    const defs = [
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.configuredEvaluationMode, "Takeover Evaluation (Konfiguration)", "disabled"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.effectiveEvaluationMode, "Takeover Evaluation (effektiv)", "disabled"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.state, "Takeover Evaluation Zustand", "not_evaluated"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.blockReason, "Takeover Blockgrund"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.eligibleRuns, "Takeover Eligible Runs"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.matchedRuns, "Takeover Matched Runs"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.mismatchedRuns, "Takeover Mismatched Runs"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.failedRuns, "Takeover Failed Runs"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.incomparableRuns, "Takeover Incomparable Runs"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.consecutiveMatches, "Takeover Consecutive Matches"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.observationStartedAt, "Takeover Observation Start"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.lastEligibleRunAt, "Takeover letzter Eligible Run"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.lastMismatchAt, "Takeover letzter Mismatch"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.lastFailureAt, "Takeover letzter Failure"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.distinctUtcDays, "Takeover Distinct UTC Days"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.slotTransitions, "Takeover Slot Transitions"),
        numState(exports.PLANNER_TAKEOVER_STATE_IDS.dayTransitions, "Takeover Day Transitions"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.authoritativeRevision, "Takeover Authoritative Revision"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.candidateRevision, "Takeover Candidate Revision"),
        strState(exports.PLANNER_TAKEOVER_STATE_IDS.evidenceRevision, "Takeover Evidence Revision"),
        boolState(exports.PLANNER_TAKEOVER_STATE_IDS.wouldBeEligible, "Takeover would-be eligible", false),
        boolState(exports.PLANNER_TAKEOVER_STATE_IDS.canonicalAllowed, "Takeover canonical allowed", false),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
}
exports.ensurePlannerTakeoverStates = ensurePlannerTakeoverStates;
function isPlannerTakeoverState(relativeId) {
    return relativeId.startsWith(exports.PLANNER_TAKEOVER_STATE_PREFIX);
}
exports.isPlannerTakeoverState = isPlannerTakeoverState;
async function writePlannerTakeoverStates(host, input) {
    const e = input.evidence;
    const d = input.decision;
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.configuredEvaluationMode, input.configuredMode);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.effectiveEvaluationMode, input.effectiveMode);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.state, e.state);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.blockReason, e.lastBlockReason ?? "");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.eligibleRuns, e.eligibleRuns);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.matchedRuns, e.matchedRuns);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.mismatchedRuns, e.mismatchedRuns);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.failedRuns, e.failedRuns);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.incomparableRuns, e.incomparableRuns);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.consecutiveMatches, e.consecutiveMatches);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.observationStartedAt, e.observationStartedAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.lastEligibleRunAt, e.lastEligibleRunAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.lastMismatchAt, e.lastMismatchAt ?? "");
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.lastFailureAt, e.lastFailureAt ?? "");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.distinctUtcDays, e.observedDistinctUtcDays);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.slotTransitions, e.observedSlotTransitions);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.dayTransitions, e.observedDayTransitions);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.authoritativeRevision, (0, canonical_1.shortenRevision)(e.lastAuthoritativeRevision ?? undefined));
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.candidateRevision, (0, canonical_1.shortenRevision)(e.lastCandidateRevision ?? undefined));
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.evidenceRevision, (0, canonical_1.shortenRevision)(e.evidenceRevision));
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.wouldBeEligible, d.wouldBeEligible);
    await (0, state_write_1.setStateIfChanged)(host, exports.PLANNER_TAKEOVER_STATE_IDS.canonicalAllowed, false);
}
exports.writePlannerTakeoverStates = writePlannerTakeoverStates;
