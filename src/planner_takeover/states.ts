import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";
import { setOptionalNumberIfChanged, setStateIfChanged } from "../policy/core/state_write";
import { shortenRevision } from "../planner_shadow/canonical";
import type { PlannerTakeoverEvidence } from "./types";
import type { PlannerTakeoverDecision } from "./types";

export const PLANNER_TAKEOVER_STATE_IDS = {
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
} as const;

export const PLANNER_TAKEOVER_STATE_PREFIX = "planner.takeover.";

function strState(id: string, name: string, def = ""): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function numState(id: string, name: string, def = 0): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function boolState(id: string, name: string, def = false): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "state", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

export async function ensurePlannerTakeoverStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "planner.takeover", "Planner Takeover Evaluation");
	const defs: StateDef[] = [
		strState(PLANNER_TAKEOVER_STATE_IDS.configuredEvaluationMode, "Takeover Evaluation (Konfiguration)", "disabled"),
		strState(PLANNER_TAKEOVER_STATE_IDS.effectiveEvaluationMode, "Takeover Evaluation (effektiv)", "disabled"),
		strState(PLANNER_TAKEOVER_STATE_IDS.state, "Takeover Evaluation Zustand", "not_evaluated"),
		strState(PLANNER_TAKEOVER_STATE_IDS.blockReason, "Takeover Blockgrund"),
		numState(PLANNER_TAKEOVER_STATE_IDS.eligibleRuns, "Takeover Eligible Runs"),
		numState(PLANNER_TAKEOVER_STATE_IDS.matchedRuns, "Takeover Matched Runs"),
		numState(PLANNER_TAKEOVER_STATE_IDS.mismatchedRuns, "Takeover Mismatched Runs"),
		numState(PLANNER_TAKEOVER_STATE_IDS.failedRuns, "Takeover Failed Runs"),
		numState(PLANNER_TAKEOVER_STATE_IDS.incomparableRuns, "Takeover Incomparable Runs"),
		numState(PLANNER_TAKEOVER_STATE_IDS.consecutiveMatches, "Takeover Consecutive Matches"),
		strState(PLANNER_TAKEOVER_STATE_IDS.observationStartedAt, "Takeover Observation Start"),
		strState(PLANNER_TAKEOVER_STATE_IDS.lastEligibleRunAt, "Takeover letzter Eligible Run"),
		strState(PLANNER_TAKEOVER_STATE_IDS.lastMismatchAt, "Takeover letzter Mismatch"),
		strState(PLANNER_TAKEOVER_STATE_IDS.lastFailureAt, "Takeover letzter Failure"),
		numState(PLANNER_TAKEOVER_STATE_IDS.distinctUtcDays, "Takeover Distinct UTC Days"),
		numState(PLANNER_TAKEOVER_STATE_IDS.slotTransitions, "Takeover Slot Transitions"),
		numState(PLANNER_TAKEOVER_STATE_IDS.dayTransitions, "Takeover Day Transitions"),
		strState(PLANNER_TAKEOVER_STATE_IDS.authoritativeRevision, "Takeover Authoritative Revision"),
		strState(PLANNER_TAKEOVER_STATE_IDS.candidateRevision, "Takeover Candidate Revision"),
		strState(PLANNER_TAKEOVER_STATE_IDS.evidenceRevision, "Takeover Evidence Revision"),
		boolState(PLANNER_TAKEOVER_STATE_IDS.wouldBeEligible, "Takeover would-be eligible", false),
		boolState(PLANNER_TAKEOVER_STATE_IDS.canonicalAllowed, "Takeover canonical allowed", false),
	];
	await ensureStates(host, defs);
}

export function isPlannerTakeoverState(relativeId: string): boolean {
	return relativeId.startsWith(PLANNER_TAKEOVER_STATE_PREFIX);
}

export async function writePlannerTakeoverStates(
	host: StateHost,
	input: {
		configuredMode: string;
		effectiveMode: string;
		evidence: PlannerTakeoverEvidence;
		decision: PlannerTakeoverDecision;
	},
): Promise<void> {
	const e = input.evidence;
	const d = input.decision;
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.configuredEvaluationMode, input.configuredMode);
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.effectiveEvaluationMode, input.effectiveMode);
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.state, e.state);
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.blockReason, e.lastBlockReason ?? "");
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.eligibleRuns, e.eligibleRuns);
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.matchedRuns, e.matchedRuns);
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.mismatchedRuns, e.mismatchedRuns);
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.failedRuns, e.failedRuns);
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.incomparableRuns, e.incomparableRuns);
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.consecutiveMatches, e.consecutiveMatches);
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.observationStartedAt, e.observationStartedAt ?? "");
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.lastEligibleRunAt, e.lastEligibleRunAt ?? "");
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.lastMismatchAt, e.lastMismatchAt ?? "");
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.lastFailureAt, e.lastFailureAt ?? "");
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.distinctUtcDays, e.observedDistinctUtcDays);
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.slotTransitions, e.observedSlotTransitions);
	await setOptionalNumberIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.dayTransitions, e.observedDayTransitions);
	await setStateIfChanged(
		host,
		PLANNER_TAKEOVER_STATE_IDS.authoritativeRevision,
		shortenRevision(e.lastAuthoritativeRevision ?? undefined),
	);
	await setStateIfChanged(
		host,
		PLANNER_TAKEOVER_STATE_IDS.candidateRevision,
		shortenRevision(e.lastCandidateRevision ?? undefined),
	);
	await setStateIfChanged(
		host,
		PLANNER_TAKEOVER_STATE_IDS.evidenceRevision,
		shortenRevision(e.evidenceRevision),
	);
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.wouldBeEligible, d.wouldBeEligible);
	await setStateIfChanged(host, PLANNER_TAKEOVER_STATE_IDS.canonicalAllowed, false);
}
