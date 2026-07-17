"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evaluateDryrunPilotReadiness = void 0;
const constants_1 = require("./constants");
/**
 * Evaluate dryrun pilot readiness. Never enables live execution; this only gates
 * whether the worker-dryrun authority may treat the pilot as "ready" instead of
 * requiring full takeover evidence.
 */
function evaluateDryrunPilotReadiness(input) {
    const codes = [];
    const blocking = [];
    const ev = input.evidence;
    const observationMs = ev?.observationStartedAt != null
        ? input.nowMs - Date.parse(ev.observationStartedAt)
        : null;
    const lastRunAgeMs = ev?.lastEligibleRunAt != null ? input.nowMs - Date.parse(ev.lastEligibleRunAt) : null;
    if (!input.evaluationObserving)
        blocking.push("evaluation_disabled");
    if (!ev) {
        blocking.push("evidence_missing");
    }
    else {
        if (ev.policyFingerprint !== input.expectedPolicyFingerprint)
            blocking.push("policy_mismatch");
        if (!input.identityMatches)
            blocking.push("identity_mismatch");
        if (ev.mismatchedRuns > constants_1.DRYRUN_PILOT_MAX_MISMATCHES)
            blocking.push("mismatches_present");
        if (ev.failedRuns > constants_1.DRYRUN_PILOT_MAX_FAILURES)
            blocking.push("failures_present");
        if (ev.eligibleRuns < constants_1.DRYRUN_PILOT_MIN_ELIGIBLE_RUNS)
            codes.push("insufficient_runs");
        if (ev.consecutiveMatches < constants_1.DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES) {
            codes.push("insufficient_consecutive_matches");
        }
        if (observationMs === null || observationMs < constants_1.DRYRUN_PILOT_MIN_OBSERVATION_MS) {
            codes.push("insufficient_observation_time");
        }
        if (ev.observedSlotTransitions < constants_1.DRYRUN_PILOT_MIN_SLOT_TRANSITIONS) {
            codes.push("insufficient_slot_transitions");
        }
        if (lastRunAgeMs === null || lastRunAgeMs > constants_1.DRYRUN_PILOT_MAX_LAST_RUN_AGE_MS) {
            codes.push("last_run_stale");
        }
    }
    const allCodes = [...new Set([...blocking, ...codes])];
    let state;
    if (blocking.length > 0)
        state = "blocked";
    else if (codes.length > 0)
        state = "not_ready";
    else
        state = "ready";
    return {
        state,
        codes: allCodes,
        primaryCode: allCodes[0] ?? null,
        eligibleRuns: ev?.eligibleRuns ?? 0,
        consecutiveMatches: ev?.consecutiveMatches ?? 0,
        observationMs,
        slotTransitions: ev?.observedSlotTransitions ?? 0,
        mismatches: ev?.mismatchedRuns ?? 0,
        failures: ev?.failedRuns ?? 0,
        lastRunAgeMs,
    };
}
exports.evaluateDryrunPilotReadiness = evaluateDryrunPilotReadiness;
