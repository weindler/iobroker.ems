import { createHash } from "node:crypto";
import { sortKeysDeep } from "../planner_preparation/canonical";
import {
	DEFAULT_TAKEOVER_READINESS_POLICY,
	TAKEOVER_EVIDENCE_SCHEMA_VERSION,
	type TakeoverReadinessPolicy,
} from "./constants";
import { utcDayKey } from "./canonize";
import type {
	DualRunCompareStatus,
	PlannerDualRunIdentity,
	PlannerTakeoverBlockReason,
	PlannerTakeoverEvidence,
	PlannerTakeoverState,
} from "./types";

export function policyFingerprint(policy: TakeoverReadinessPolicy): string {
	return createHash("sha256").update(JSON.stringify(sortKeysDeep(policy)), "utf8").digest("hex").slice(0, 16);
}

export function emptyTakeoverEvidence(policy: TakeoverReadinessPolicy = DEFAULT_TAKEOVER_READINESS_POLICY): PlannerTakeoverEvidence {
	return {
		schemaVersion: TAKEOVER_EVIDENCE_SCHEMA_VERSION,
		state: "not_evaluated",
		eligibleRuns: 0,
		matchedRuns: 0,
		mismatchedRuns: 0,
		failedRuns: 0,
		incomparableRuns: 0,
		consecutiveMatches: 0,
		observationStartedAt: null,
		lastEligibleRunAt: null,
		lastMatchAt: null,
		lastMismatchAt: null,
		lastFailureAt: null,
		observedDistinctUtcDays: 0,
		observedSlotTransitions: 0,
		observedDayTransitions: 0,
		lastBlockReason: "evaluation_disabled",
		firstMismatchDomain: null,
		evidenceRevision: "",
		policyFingerprint: policyFingerprint(policy),
		plannerSchemaVersion: 1,
		lastAuthoritativeRevision: null,
		lastCandidateRevision: null,
		lastHorizonStart: null,
		lastHorizonEnd: null,
		observedUtcDayKeys: [],
	};
}

export function computeEvidenceRevision(evidence: Omit<PlannerTakeoverEvidence, "evidenceRevision">): string {
	return createHash("sha256").update(JSON.stringify(sortKeysDeep(evidence)), "utf8").digest("hex");
}

export function sealEvidence(evidence: Omit<PlannerTakeoverEvidence, "evidenceRevision">): PlannerTakeoverEvidence {
	return { ...evidence, evidenceRevision: computeEvidenceRevision(evidence) };
}

export interface DualRunEvidenceEvent {
	nowIso: string;
	observing: boolean;
	shuttingDown: boolean;
	identity: PlannerDualRunIdentity;
	compareStatus: DualRunCompareStatus;
	firstMismatchDomain?: string | null;
	authoritativeRevision?: string | null;
	candidateRevision?: string | null;
	errorCode?: string | null;
	policy?: TakeoverReadinessPolicy;
	/** When true, run is diagnostic-only (force/manual) and never eligible. */
	diagnosticOnly?: boolean;
}

function mapFailureBlockReason(errorCode: string | null | undefined): PlannerTakeoverBlockReason {
	if (!errorCode) return "worker_failed";
	if (errorCode.includes("timeout")) return "worker_timeout";
	if (errorCode.includes("crash") || errorCode.includes("exit")) return "worker_crash";
	if (errorCode.includes("shutdown") || errorCode.includes("stopping")) return "shutdown";
	if (errorCode.includes("authoritative")) return "authoritative_failed";
	return "worker_failed";
}

function recomputeState(
	evidence: PlannerTakeoverEvidence,
	policy: TakeoverReadinessPolicy,
	nowMs: number,
): { state: PlannerTakeoverState; blockReason: PlannerTakeoverBlockReason } {
	// A fresh consecutive match series can clear a prior mismatch/failure block.
	const seriesHealthy = evidence.consecutiveMatches >= policy.minConsecutiveMatches;

	if (!seriesHealthy && evidence.lastBlockReason === "semantic_mismatch") {
		return { state: "blocked", blockReason: "semantic_mismatch" };
	}
	if (!seriesHealthy && evidence.failedRuns > policy.maxFailures && evidence.lastFailureAt) {
		return {
			state: "blocked",
			blockReason:
				evidence.lastBlockReason && evidence.lastBlockReason !== "evaluation_disabled"
					? evidence.lastBlockReason
					: "worker_failed",
		};
	}

	const started = evidence.observationStartedAt ? Date.parse(evidence.observationStartedAt) : NaN;
	const observationOk = Number.isFinite(started) && nowMs - started >= policy.minObservationMs;
	const lastEligibleMs = evidence.lastEligibleRunAt ? Date.parse(evidence.lastEligibleRunAt) : NaN;
	const freshOk =
		Number.isFinite(lastEligibleMs) && nowMs - lastEligibleMs <= policy.maxStaleEligibleMs;

	const missing: PlannerTakeoverBlockReason[] = [];
	if (evidence.eligibleRuns < policy.minEligibleRuns) missing.push("insufficient_runs");
	if (evidence.consecutiveMatches < policy.minConsecutiveMatches) missing.push("insufficient_runs");
	if (!observationOk) missing.push("insufficient_observation_time");
	if (evidence.observedDistinctUtcDays < policy.minDistinctUtcDays) missing.push("insufficient_distinct_days");
	if (policy.requireSlotTransition && evidence.observedSlotTransitions < 1) missing.push("no_slot_transition");
	if (policy.requireDayTransition && evidence.observedDayTransitions < 1) missing.push("no_day_transition");
	if (!freshOk) missing.push("stale_eligible_run");

	if (missing.length === 0 && seriesHealthy) {
		return { state: "ready", blockReason: null };
	}
	return { state: "collecting", blockReason: missing[0] ?? null };
}

/**
 * Apply one dual-run outcome to evidence. Pure and deterministic.
 * Aborted/shutdown runs never create positive or mismatch evidence.
 */
export function applyDualRunToEvidence(
	previous: PlannerTakeoverEvidence | null,
	event: DualRunEvidenceEvent,
): PlannerTakeoverEvidence {
	const policy = event.policy ?? DEFAULT_TAKEOVER_READINESS_POLICY;
	const fp = policyFingerprint(policy);

	if (!event.observing) {
		return sealEvidence({
			...emptyTakeoverEvidence(policy),
			state: "not_evaluated",
			lastBlockReason: event.identity.force ? "evaluation_disabled" : "evaluation_disabled",
			policyFingerprint: fp,
		});
	}

	if (event.shuttingDown || event.compareStatus === "aborted") {
		const base = previous && previous.policyFingerprint === fp ? previous : emptyTakeoverEvidence(policy);
		return sealEvidence({
			...base,
			policyFingerprint: fp,
			// do not mutate counters on abort
			lastBlockReason: event.shuttingDown ? "shutdown" : base.lastBlockReason,
			state: base.state === "ready" ? "collecting" : base.state === "not_evaluated" ? "collecting" : base.state,
		});
	}

	let evidence =
		previous &&
		previous.schemaVersion === TAKEOVER_EVIDENCE_SCHEMA_VERSION &&
		previous.policyFingerprint === fp
			? { ...previous, observedUtcDayKeys: [...previous.observedUtcDayKeys] }
			: {
					...emptyTakeoverEvidence(policy),
					state: "collecting" as const,
					observationStartedAt: event.nowIso,
					lastBlockReason: previous ? ("policy_reset" as const) : null,
					policyFingerprint: fp,
				};

	if (!evidence.observationStartedAt) {
		evidence.observationStartedAt = event.nowIso;
	}

	const diagnosticOnly = event.diagnosticOnly === true || event.identity.force === true;
	const day = utcDayKey(event.nowIso);

	if (diagnosticOnly) {
		// Diagnostic compare only — never eligible, never readiness.
		if (event.compareStatus === "not_comparable") {
			evidence.incomparableRuns += 1;
		}
		const sealed = sealEvidence({
			...evidence,
			state: evidence.state === "ready" ? "collecting" : evidence.state === "not_evaluated" ? "collecting" : evidence.state,
			lastBlockReason: evidence.lastBlockReason ?? "evaluation_disabled",
			policyFingerprint: fp,
		});
		return sealed;
	}

	const eligibleStatuses: DualRunCompareStatus[] = ["matched", "mismatch", "validation_failed", "worker_failed", "authoritative_failed"];
	const isEligibleShape =
		eligibleStatuses.includes(event.compareStatus) &&
		event.compareStatus !== "not_comparable" &&
		!!event.authoritativeRevision &&
		!!event.candidateRevision;

	if (event.compareStatus === "not_comparable") {
		evidence.incomparableRuns += 1;
		evidence.lastBlockReason = "input_not_comparable";
		evidence.state = "collecting";
		return sealEvidence({ ...evidence, policyFingerprint: fp });
	}

	if (!isEligibleShape && (event.compareStatus === "worker_failed" || event.compareStatus === "authoritative_failed")) {
		evidence.failedRuns += 1;
		evidence.consecutiveMatches = 0;
		evidence.lastFailureAt = event.nowIso;
		evidence.lastBlockReason = mapFailureBlockReason(event.errorCode);
		evidence.state = "blocked";
		return sealEvidence({ ...evidence, policyFingerprint: fp });
	}

	if (event.compareStatus === "worker_failed" || event.compareStatus === "authoritative_failed") {
		evidence.eligibleRuns += 1;
		evidence.failedRuns += 1;
		evidence.consecutiveMatches = 0;
		evidence.lastEligibleRunAt = event.nowIso;
		evidence.lastFailureAt = event.nowIso;
		evidence.lastAuthoritativeRevision = event.authoritativeRevision ?? evidence.lastAuthoritativeRevision;
		evidence.lastCandidateRevision = event.candidateRevision ?? evidence.lastCandidateRevision;
		evidence.lastBlockReason = mapFailureBlockReason(event.errorCode);
		evidence.state = "blocked";
		return sealEvidence({ ...evidence, policyFingerprint: fp });
	}

	if (event.compareStatus === "validation_failed") {
		evidence.eligibleRuns += 1;
		evidence.failedRuns += 1;
		evidence.consecutiveMatches = 0;
		evidence.lastEligibleRunAt = event.nowIso;
		evidence.lastFailureAt = event.nowIso;
		evidence.lastBlockReason = "candidate_invalid";
		evidence.state = "blocked";
		return sealEvidence({ ...evidence, policyFingerprint: fp });
	}

	if (event.compareStatus === "mismatch") {
		evidence.eligibleRuns += 1;
		evidence.mismatchedRuns += 1;
		evidence.consecutiveMatches = 0;
		evidence.lastEligibleRunAt = event.nowIso;
		evidence.lastMismatchAt = event.nowIso;
		evidence.firstMismatchDomain = event.firstMismatchDomain ?? null;
		evidence.lastAuthoritativeRevision = event.authoritativeRevision ?? null;
		evidence.lastCandidateRevision = event.candidateRevision ?? null;
		evidence.lastBlockReason = "semantic_mismatch";
		evidence.state = "blocked";
		trackTransitions(evidence, event, day);
		return sealEvidence({ ...evidence, policyFingerprint: fp });
	}

	// matched
	evidence.eligibleRuns += 1;
	evidence.matchedRuns += 1;
	evidence.consecutiveMatches += 1;
	evidence.lastEligibleRunAt = event.nowIso;
	evidence.lastMatchAt = event.nowIso;
	evidence.lastAuthoritativeRevision = event.authoritativeRevision ?? null;
	evidence.lastCandidateRevision = event.candidateRevision ?? null;
	trackTransitions(evidence, event, day);

	const nowMs = Date.parse(event.nowIso);
	const { state, blockReason } = recomputeState(evidence, policy, nowMs);
	evidence.state = state;
	evidence.lastBlockReason = blockReason;
	return sealEvidence({ ...evidence, policyFingerprint: fp });
}

function trackTransitions(
	evidence: PlannerTakeoverEvidence,
	event: DualRunEvidenceEvent,
	day: string,
): void {
	const prevStart = evidence.lastHorizonStart;
	const prevEnd = evidence.lastHorizonEnd;
	const nextStart = event.identity.planningHorizonStart;
	const nextEnd = event.identity.planningHorizonEnd;
	if (prevStart && prevEnd && (prevStart !== nextStart || prevEnd !== nextEnd)) {
		evidence.observedSlotTransitions += 1;
		if (utcDayKey(prevStart) !== utcDayKey(nextStart)) {
			evidence.observedDayTransitions += 1;
		}
	} else if (!prevStart && nextStart) {
		// first horizon recorded — not yet a transition
	}
	evidence.lastHorizonStart = nextStart;
	evidence.lastHorizonEnd = nextEnd;

	if (!evidence.observedUtcDayKeys.includes(day)) {
		evidence.observedUtcDayKeys.push(day);
		if (evidence.observedUtcDayKeys.length > 64) {
			evidence.observedUtcDayKeys = evidence.observedUtcDayKeys.slice(-64);
		}
	}
	evidence.observedDistinctUtcDays = evidence.observedUtcDayKeys.length;
}

/**
 * Validate / migrate loaded evidence. Incompatible schema or policy → fresh collecting.
 */
export function reconcileLoadedEvidence(
	raw: unknown,
	policy: TakeoverReadinessPolicy = DEFAULT_TAKEOVER_READINESS_POLICY,
): { evidence: PlannerTakeoverEvidence; resetReason: string | null } {
	const fp = policyFingerprint(policy);
	if (!raw || typeof raw !== "object") {
		return { evidence: sealEvidence({ ...emptyTakeoverEvidence(policy), state: "collecting", lastBlockReason: "policy_reset" }), resetReason: "missing" };
	}
	const e = raw as Partial<PlannerTakeoverEvidence>;
	if (e.schemaVersion !== TAKEOVER_EVIDENCE_SCHEMA_VERSION) {
		return {
			evidence: sealEvidence({
				...emptyTakeoverEvidence(policy),
				state: "collecting",
				lastBlockReason: "schema_mismatch",
			}),
			resetReason: "schema_mismatch",
		};
	}
	if (e.policyFingerprint !== fp) {
		return {
			evidence: sealEvidence({
				...emptyTakeoverEvidence(policy),
				state: "collecting",
				lastBlockReason: "policy_reset",
			}),
			resetReason: "policy_reset",
		};
	}
	// Never inherit unchecked ready across restart without recompute.
	const sealed = sealEvidence({
		...(e as PlannerTakeoverEvidence),
		observedUtcDayKeys: Array.isArray(e.observedUtcDayKeys) ? e.observedUtcDayKeys.map(String) : [],
		policyFingerprint: fp,
	});
	const nowMs = Date.now();
	const { state, blockReason } = recomputeState(sealed, policy, nowMs);
	return {
		evidence: sealEvidence({ ...sealed, state, lastBlockReason: blockReason }),
		resetReason: null,
	};
}
