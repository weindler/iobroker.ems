import type { PlannerTakeoverEvidence } from "../planner_takeover/types";
import {
	DRYRUN_PILOT_MAX_FAILURES,
	DRYRUN_PILOT_MAX_LAST_RUN_AGE_MS,
	DRYRUN_PILOT_MAX_MISMATCHES,
	DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES,
	DRYRUN_PILOT_MIN_ELIGIBLE_RUNS,
	DRYRUN_PILOT_MIN_OBSERVATION_MS,
	DRYRUN_PILOT_MIN_SLOT_TRANSITIONS,
} from "./constants";
import type { PlannerDryrunPilotCode, PlannerDryrunPilotReadiness } from "./types";

export interface DryrunPilotReadinessInput {
	evaluationObserving: boolean;
	evidence: PlannerTakeoverEvidence | null;
	nowMs: number;
	expectedPolicyFingerprint: string;
	identityMatches: boolean;
}

/**
 * Evaluate dryrun pilot readiness. Never enables live execution; this only gates
 * whether the worker-dryrun authority may treat the pilot as "ready" instead of
 * requiring full takeover evidence.
 */
export function evaluateDryrunPilotReadiness(
	input: DryrunPilotReadinessInput,
): PlannerDryrunPilotReadiness {
	const codes: PlannerDryrunPilotCode[] = [];
	const blocking: PlannerDryrunPilotCode[] = [];
	const ev = input.evidence;

	const observationMs =
		ev?.observationStartedAt != null
			? input.nowMs - Date.parse(ev.observationStartedAt)
			: null;
	const lastRunAgeMs =
		ev?.lastEligibleRunAt != null ? input.nowMs - Date.parse(ev.lastEligibleRunAt) : null;

	if (!input.evaluationObserving) blocking.push("evaluation_disabled");
	if (!ev) {
		blocking.push("evidence_missing");
	} else {
		if (ev.policyFingerprint !== input.expectedPolicyFingerprint) blocking.push("policy_mismatch");
		if (!input.identityMatches) blocking.push("identity_mismatch");
		if (ev.mismatchedRuns > DRYRUN_PILOT_MAX_MISMATCHES) blocking.push("mismatches_present");
		if (ev.failedRuns > DRYRUN_PILOT_MAX_FAILURES) blocking.push("failures_present");

		if (ev.eligibleRuns < DRYRUN_PILOT_MIN_ELIGIBLE_RUNS) codes.push("insufficient_runs");
		if (ev.consecutiveMatches < DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES) {
			codes.push("insufficient_consecutive_matches");
		}
		if (observationMs === null || observationMs < DRYRUN_PILOT_MIN_OBSERVATION_MS) {
			codes.push("insufficient_observation_time");
		}
		if (ev.observedSlotTransitions < DRYRUN_PILOT_MIN_SLOT_TRANSITIONS) {
			codes.push("insufficient_slot_transitions");
		}
		if (lastRunAgeMs === null || lastRunAgeMs > DRYRUN_PILOT_MAX_LAST_RUN_AGE_MS) {
			codes.push("last_run_stale");
		}
	}

	const allCodes = [...new Set([...blocking, ...codes])];
	let state: PlannerDryrunPilotReadiness["state"];
	if (blocking.length > 0) state = "blocked";
	else if (codes.length > 0) state = "not_ready";
	else state = "ready";

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
