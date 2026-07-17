import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateDryrunPilotReadiness } from "./pilot_readiness.js";
import {
	DRYRUN_PILOT_MIN_ELIGIBLE_RUNS,
	DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES,
	DRYRUN_PILOT_MIN_OBSERVATION_MS,
} from "./constants.js";
import { emptyTakeoverEvidence, policyFingerprint } from "../planner_takeover/evidence.js";
import { DEFAULT_TAKEOVER_READINESS_POLICY } from "../planner_takeover/constants.js";
import type { PlannerTakeoverEvidence } from "../planner_takeover/types.js";

const FP = policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY);

function evidence(over: Partial<PlannerTakeoverEvidence> = {}): PlannerTakeoverEvidence {
	const now = Date.now();
	return {
		...emptyTakeoverEvidence(),
		state: "collecting",
		eligibleRuns: DRYRUN_PILOT_MIN_ELIGIBLE_RUNS,
		matchedRuns: DRYRUN_PILOT_MIN_ELIGIBLE_RUNS,
		consecutiveMatches: DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES,
		mismatchedRuns: 0,
		failedRuns: 0,
		observationStartedAt: new Date(now - DRYRUN_PILOT_MIN_OBSERVATION_MS - 1000).toISOString(),
		lastEligibleRunAt: new Date(now).toISOString(),
		observedSlotTransitions: 2,
		policyFingerprint: FP,
		evidenceRevision: "rev-1",
		...over,
	};
}

describe("planner_authority dryrun pilot readiness", () => {
	const base = {
		evaluationObserving: true,
		nowMs: Date.now(),
		expectedPolicyFingerprint: FP,
		identityMatches: true,
	};

	it("ready when all thresholds met", () => {
		const r = evaluateDryrunPilotReadiness({ ...base, evidence: evidence() });
		assert.equal(r.state, "ready");
		assert.equal(r.primaryCode, null);
	});

	it("blocked when evidence missing", () => {
		const r = evaluateDryrunPilotReadiness({ ...base, evidence: null });
		assert.equal(r.state, "blocked");
		assert.equal(r.primaryCode, "evidence_missing");
	});

	it("blocked on mismatches", () => {
		const r = evaluateDryrunPilotReadiness({ ...base, evidence: evidence({ mismatchedRuns: 1 }) });
		assert.equal(r.state, "blocked");
		assert.ok(r.codes.includes("mismatches_present"));
	});

	it("blocked on failures", () => {
		const r = evaluateDryrunPilotReadiness({ ...base, evidence: evidence({ failedRuns: 1 }) });
		assert.equal(r.state, "blocked");
		assert.ok(r.codes.includes("failures_present"));
	});

	it("not_ready on insufficient runs", () => {
		const r = evaluateDryrunPilotReadiness({ ...base, evidence: evidence({ eligibleRuns: 1 }) });
		assert.equal(r.state, "not_ready");
		assert.ok(r.codes.includes("insufficient_runs"));
	});

	it("blocked on policy mismatch", () => {
		const r = evaluateDryrunPilotReadiness({
			...base,
			evidence: evidence({ policyFingerprint: "other" }),
		});
		assert.equal(r.state, "blocked");
		assert.ok(r.codes.includes("policy_mismatch"));
	});

	it("blocked on identity mismatch", () => {
		const r = evaluateDryrunPilotReadiness({ ...base, identityMatches: false, evidence: evidence() });
		assert.equal(r.state, "blocked");
		assert.ok(r.codes.includes("identity_mismatch"));
	});
});
