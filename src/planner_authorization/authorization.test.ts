import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	parsePlannerTakeoverAuthorizationMode,
	PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT,
} from "../planner_config/authorization_mode.js";
import { canTransitionAuthorizationState, transitionAuthorizationState } from "./state_machine.js";
import { evaluateAuthorizationEligibility } from "./eligibility.js";
import { createTakeoverChallenge, challengeExpired } from "./challenge.js";
import {
	mintAuthorizationGrantFromChallenge,
	isAuthorizationGrant,
	grantExpired,
} from "./grant.js";
import { tryMintProductiveActivationCapability } from "./activation.js";
import { evaluateCanonicalPermitMintPreview, tryMintCanonicalPublishPermitWithGrant } from "./permit_preview.js";
import { tryMintCanonicalPublishPermitFromShadow } from "../planner_publish/permit.js";
import { ChallengeReplayCache } from "./replay.js";
import { AuthorizationMutex } from "./mutex.js";
import { appendAuditEntry, emptyAuditFile } from "./audit_io.js";
import { PlannerAuthorizationService } from "./service.js";
import { policyFingerprint, emptyTakeoverEvidence, sealEvidence } from "../planner_takeover/evidence.js";
import {
	DEFAULT_TAKEOVER_READINESS_POLICY,
	TAKEOVER_EVIDENCE_SCHEMA_VERSION,
} from "../planner_takeover/constants.js";
import type { PlannerTakeoverEvidence } from "../planner_takeover/types.js";
import { isDeniedPlannerTriggerState } from "../planner_trigger/catalog.js";

function readyEvidence(): PlannerTakeoverEvidence {
	return sealEvidence({
		...emptyTakeoverEvidence(DEFAULT_TAKEOVER_READINESS_POLICY),
		state: "ready",
		eligibleRuns: 100,
		matchedRuns: 100,
		consecutiveMatches: 100,
		observationStartedAt: "2026-07-16T00:00:00Z",
		lastEligibleRunAt: new Date().toISOString(),
		lastMatchAt: new Date().toISOString(),
		lastBlockReason: null,
		policyFingerprint: policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY),
		lastAuthoritativeRevision: "a".repeat(64),
		lastCandidateRevision: "b".repeat(64),
		observedDistinctUtcDays: 2,
		observedSlotTransitions: 2,
		observedDayTransitions: 1,
	});
}

function baseElig(over: Partial<Parameters<typeof evaluateAuthorizationEligibility>[0]> = {}) {
	return evaluateAuthorizationEligibility({
		nowMs: Date.now(),
		adapterReady: true,
		shuttingDown: false,
		restoreBarrierActive: false,
		operationLockActive: false,
		plannerRuntimeMode: "shadow_auto",
		evaluationMode: "observe",
		authorizationMode: "manual_prepare",
		evidence: readyEvidence(),
		expectedEvidenceSchemaVersion: TAKEOVER_EVIDENCE_SCHEMA_VERSION,
		expectedPolicyFingerprint: policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY),
		lastCompareStatus: "matched",
		authoritativeRevision: "a".repeat(64),
		candidateRevision: "b".repeat(64),
		inputRevision: "c".repeat(64),
		generationMatches: true,
		horizonMatches: true,
		candidateValid: true,
		authoritativePublishOk: true,
		plannerJobActive: false,
		pendingRerun: false,
		executionMode: "dryrun",
		challengeActive: false,
		grantActive: false,
		releaseGateClosed: true,
		...over,
	});
}

function bound() {
	return {
		generation: 1,
		inputRevision: "c".repeat(64),
		candidateRevision: "b".repeat(64),
		authoritativeRevision: "a".repeat(64),
		evidenceRevision: readyEvidence().evidenceRevision,
		evidencePolicyRevision: policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY),
		planningHorizonStart: "2026-07-17T10:00:00Z",
		planningHorizonEnd: "2026-07-18T10:00:00Z",
		slotDurationMinutes: 15,
		plannerContractVersion: 1,
		snapshotSchemaVersion: 1,
		publishPolicyRevision: "phase_3g_closed",
	};
}

describe("planner_authorization config", () => {
	it("defaults to disabled", () => {
		assert.equal(PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, "disabled");
		assert.equal(parsePlannerTakeoverAuthorizationMode(undefined).mode, "disabled");
	});

	it("clamps invalid values", () => {
		const p = parsePlannerTakeoverAuthorizationMode("auto_takeover");
		assert.equal(p.mode, "disabled");
		assert.equal(p.clamped, true);
	});
});

describe("planner_authorization state machine", () => {
	it("allows prepared → confirmed → activation_blocked", () => {
		assert.equal(transitionAuthorizationState("prepared", "confirmed"), "confirmed");
		assert.equal(transitionAuthorizationState("confirmed", "activation_blocked"), "activation_blocked");
	});

	it("rejects idle → confirmed", () => {
		assert.equal(canTransitionAuthorizationState("idle", "confirmed"), false);
		assert.throws(() => transitionAuthorizationState("idle", "confirmed"));
	});
});

describe("planner_authorization eligibility", () => {
	it("full factors allow prepare", () => {
		assert.equal(baseElig().eligible, true);
	});

	it("evidence not ready blocks", () => {
		assert.ok(baseElig({ evidence: null }).codes.includes("evidence_not_ready"));
	});

	it("live execution mode blocks", () => {
		assert.ok(baseElig({ executionMode: "live" }).codes.includes("execution_mode_not_dryrun"));
	});

	it("publish seal failed blocks", () => {
		assert.ok(baseElig({ authoritativePublishOk: false }).codes.includes("authoritative_publish_failed"));
	});

	it("mismatch blocks", () => {
		assert.ok(baseElig({ lastCompareStatus: "mismatch" }).codes.includes("newer_mismatch"));
	});
});

describe("planner_authorization challenge grant permit", () => {
	it("prepare→confirm yields activation_blocked without permit", async () => {
		let evidence = readyEvidence();
		const b = bound();
		b.evidenceRevision = evidence.evidenceRevision;
		const service = new PlannerAuthorizationService({
			now: () => new Date("2026-07-17T12:00:00Z"),
			adapterInstance: "ems.0",
			sessionId: "session-1",
			auditDir: null,
			idFactory: () => "fixed-challenge-id",
			getRuntimeMode: () => "shadow_auto",
			getEvaluationMode: () => "observe",
			getAuthorizationMode: () => "manual_prepare",
			getEvidence: () => evidence,
			getEligibilityExtras: () => ({
				lastCompareStatus: "matched",
				authoritativeRevision: b.authoritativeRevision,
				candidateRevision: b.candidateRevision,
				inputRevision: b.inputRevision,
				generationMatches: true,
				horizonMatches: true,
				candidateValid: true,
				authoritativePublishOk: true,
				executionMode: "dryrun",
				bound: b,
			}),
		});
		await service.syncFromConfig();
		const prep = await service.prepare();
		assert.equal(prep.ok, true);
		assert.equal(service.getPublicStatus().state, "prepared");
		assert.equal(service.getPublicStatus().challengeId, "fixed-challenge-id");

		const conf = await service.confirm("fixed-challenge-id");
		assert.equal(conf.ok, true);
		assert.equal(conf.code, "activation_blocked");
		const status = service.getPublicStatus();
		assert.equal(status.state, "activation_blocked");
		assert.equal(status.grantActive, true);
		assert.equal(status.activationCapabilityPresent, false);
		assert.equal(status.permitMinted, false);
		assert.equal(status.canonicalAllowed, false);

		const preview = service.previewPermitMint();
		assert.equal(preview.permitMinted, false);
		assert.equal(preview.canonicalAllowed, false);
		assert.equal(preview.productiveActivationCapabilityPresent, false);
		assert.equal(preview.authorizationState, "activation_blocked");
		assert.ok(preview.primaryBlockReason === "activation_capability_missing" || preview.blockReasonCount >= 1);

		assert.equal(tryMintCanonicalPublishPermitFromShadow({ authorizationGrant: true }), null);
		assert.equal(tryMintProductiveActivationCapability({ grantPresent: true }), null);
		assert.equal(tryMintCanonicalPublishPermitWithGrant({ grant: null, nowMs: Date.now() }), null);

		// replay rejected
		const again = await service.confirm("fixed-challenge-id");
		assert.equal(again.ok, false);
	});

	it("wrong confirm id increments failures then invalidates", async () => {
		const evidence = readyEvidence();
		const b = bound();
		b.evidenceRevision = evidence.evidenceRevision;
		let n = 0;
		const service = new PlannerAuthorizationService({
			now: () => new Date("2026-07-17T12:00:00Z"),
			adapterInstance: "ems.0",
			sessionId: "session-1",
			auditDir: null,
			idFactory: () => `id-${++n}`,
			getRuntimeMode: () => "shadow_auto",
			getEvaluationMode: () => "observe",
			getAuthorizationMode: () => "manual_prepare",
			getEvidence: () => evidence,
			getEligibilityExtras: () => ({
				lastCompareStatus: "matched",
				authoritativeRevision: b.authoritativeRevision,
				candidateRevision: b.candidateRevision,
				inputRevision: b.inputRevision,
				generationMatches: true,
				horizonMatches: true,
				candidateValid: true,
				authoritativePublishOk: true,
				executionMode: "dryrun",
				bound: b,
			}),
		});
		await service.syncFromConfig();
		await service.prepare();
		assert.equal((await service.confirm("wrong")).ok, false);
		assert.equal((await service.confirm("wrong")).ok, false);
		const third = await service.confirm("wrong");
		assert.equal(third.ok, false);
		assert.equal(third.code, "challenge_invalidated");
	});

	it("grant is WeakSet-branded and not forged from JSON", () => {
		const challenge = createTakeoverChallenge({
			adapterInstance: "ems.0",
			sessionId: "s",
			nowMs: Date.now(),
			...bound(),
			idFactory: () => "ch-1",
		});
		const grant = mintAuthorizationGrantFromChallenge(challenge, Date.now(), () => "g-1");
		assert.equal(isAuthorizationGrant(grant), true);
		assert.equal(isAuthorizationGrant(JSON.parse(JSON.stringify(grant))), false);
		assert.equal(grantExpired(grant, Date.parse(grant.expiresAt) + 1), true);
		assert.equal(challengeExpired(challenge, Date.parse(challenge.expiresAt) + 1), true);
	});
});

describe("planner_authorization race replay audit denylist", () => {
	it("mutex serializes operations", async () => {
		const m = new AuthorizationMutex();
		const order: number[] = [];
		await Promise.all([
			m.runExclusive(async () => {
				order.push(1);
				await new Promise((r) => setTimeout(r, 20));
				order.push(2);
			}),
			m.runExclusive(async () => {
				order.push(3);
			}),
		]);
		assert.deepEqual(order, [1, 2, 3]);
	});

	it("replay cache is bounded", () => {
		const c = new ChallengeReplayCache(3);
		c.remember("a", Date.now() + 10_000);
		c.remember("b", Date.now() + 10_000);
		c.remember("c", Date.now() + 10_000);
		c.remember("d", Date.now() + 10_000);
		assert.equal(c.size(), 3);
		assert.equal(c.has("a", Date.now()), false);
		assert.equal(c.has("d", Date.now()), true);
	});

	it("audit append respects max entries", () => {
		let file = emptyAuditFile();
		for (let i = 0; i < 5; i++) {
			file = appendAuditEntry(
				file,
				{
					timestamp: new Date().toISOString(),
					eventCode: "x",
					resultCode: "ok",
					challengeIdShort: null,
					grantIdShort: null,
					generation: i,
					inputRevisionShort: null,
					candidateRevisionShort: null,
					authoritativeRevisionShort: null,
					evidenceRevisionShort: null,
					sessionIdShort: "s",
				},
				3,
			);
		}
		assert.equal(file.entries.length, 3);
	});

	it("authorization states are denied as planner triggers", () => {
		assert.equal(isDeniedPlannerTriggerState("planner.takeover.authorization.prepare"), true);
		assert.equal(isDeniedPlannerTriggerState("planner.takeover.authorization.confirm"), true);
	});
});
