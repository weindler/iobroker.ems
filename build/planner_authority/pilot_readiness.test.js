"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pilot_readiness_js_1 = require("./pilot_readiness.js");
const constants_js_1 = require("./constants.js");
const evidence_js_1 = require("../planner_takeover/evidence.js");
const constants_js_2 = require("../planner_takeover/constants.js");
const FP = (0, evidence_js_1.policyFingerprint)(constants_js_2.DEFAULT_TAKEOVER_READINESS_POLICY);
function evidence(over = {}) {
    const now = Date.now();
    return {
        ...(0, evidence_js_1.emptyTakeoverEvidence)(),
        state: "collecting",
        eligibleRuns: constants_js_1.DRYRUN_PILOT_MIN_ELIGIBLE_RUNS,
        matchedRuns: constants_js_1.DRYRUN_PILOT_MIN_ELIGIBLE_RUNS,
        consecutiveMatches: constants_js_1.DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES,
        mismatchedRuns: 0,
        failedRuns: 0,
        observationStartedAt: new Date(now - constants_js_1.DRYRUN_PILOT_MIN_OBSERVATION_MS - 1000).toISOString(),
        lastEligibleRunAt: new Date(now).toISOString(),
        observedSlotTransitions: 2,
        policyFingerprint: FP,
        evidenceRevision: "rev-1",
        ...over,
    };
}
(0, node_test_1.describe)("planner_authority dryrun pilot readiness", () => {
    const base = {
        evaluationObserving: true,
        nowMs: Date.now(),
        expectedPolicyFingerprint: FP,
        identityMatches: true,
    };
    (0, node_test_1.it)("ready when all thresholds met", () => {
        const r = (0, pilot_readiness_js_1.evaluateDryrunPilotReadiness)({ ...base, evidence: evidence() });
        strict_1.default.equal(r.state, "ready");
        strict_1.default.equal(r.primaryCode, null);
    });
    (0, node_test_1.it)("blocked when evidence missing", () => {
        const r = (0, pilot_readiness_js_1.evaluateDryrunPilotReadiness)({ ...base, evidence: null });
        strict_1.default.equal(r.state, "blocked");
        strict_1.default.equal(r.primaryCode, "evidence_missing");
    });
    (0, node_test_1.it)("blocked on mismatches", () => {
        const r = (0, pilot_readiness_js_1.evaluateDryrunPilotReadiness)({ ...base, evidence: evidence({ mismatchedRuns: 1 }) });
        strict_1.default.equal(r.state, "blocked");
        strict_1.default.ok(r.codes.includes("mismatches_present"));
    });
    (0, node_test_1.it)("blocked on failures", () => {
        const r = (0, pilot_readiness_js_1.evaluateDryrunPilotReadiness)({ ...base, evidence: evidence({ failedRuns: 1 }) });
        strict_1.default.equal(r.state, "blocked");
        strict_1.default.ok(r.codes.includes("failures_present"));
    });
    (0, node_test_1.it)("not_ready on insufficient runs", () => {
        const r = (0, pilot_readiness_js_1.evaluateDryrunPilotReadiness)({ ...base, evidence: evidence({ eligibleRuns: 1 }) });
        strict_1.default.equal(r.state, "not_ready");
        strict_1.default.ok(r.codes.includes("insufficient_runs"));
    });
    (0, node_test_1.it)("blocked on policy mismatch", () => {
        const r = (0, pilot_readiness_js_1.evaluateDryrunPilotReadiness)({
            ...base,
            evidence: evidence({ policyFingerprint: "other" }),
        });
        strict_1.default.equal(r.state, "blocked");
        strict_1.default.ok(r.codes.includes("policy_mismatch"));
    });
    (0, node_test_1.it)("blocked on identity mismatch", () => {
        const r = (0, pilot_readiness_js_1.evaluateDryrunPilotReadiness)({ ...base, identityMatches: false, evidence: evidence() });
        strict_1.default.equal(r.state, "blocked");
        strict_1.default.ok(r.codes.includes("identity_mismatch"));
    });
});
