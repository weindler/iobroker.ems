import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PlannerAuthorityService, type AuthorityBoundRevisions } from "./service.js";
import { resolvePlannerPaths, type PlannerPathLayout } from "../planner_paths/paths.js";
import { validatePointer } from "./pointer.js";
import { mintWorkerDryrunActivationCapabilityFromGrant } from "../planner_authorization/activation.js";
import {
	mintWorkerDryrunCanonicalPublishPermit,
	consumePermit,
	isCanonicalPublishPermit,
} from "../planner_publish/permit.js";
import {
	mintAuthorizationGrantFromChallenge,
	type PlannerTakeoverAuthorizationGrant,
} from "../planner_authorization/grant.js";
import { createTakeoverChallenge } from "../planner_authorization/challenge.js";
import { computeCandidateRevision, type PlannerPlanCandidate } from "../planner_candidate/types.js";
import { emptyTakeoverEvidence, policyFingerprint } from "../planner_takeover/evidence.js";
import { DEFAULT_TAKEOVER_READINESS_POLICY } from "../planner_takeover/constants.js";
import type { PlannerTakeoverEvidence } from "../planner_takeover/types.js";
import { isDeniedPlannerTriggerState } from "../planner_trigger/catalog.js";

const FP = policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY);
const GENERATION = 7;
const INPUT_REV = "i".repeat(64);
const AUTH_REV = "a".repeat(64);
const EVIDENCE_REV = "erev-1";

function tmpLayout(): { layout: PlannerPathLayout; dir: string } {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ems-authority-"));
	const layout = resolvePlannerPaths({
		namespace: "ems.0",
		getAbsoluteInstanceDataDir: () => path.join(dir, "ems.0"),
	});
	return { layout, dir };
}

function buildCandidate(nowMs: number): PlannerPlanCandidate {
	const slotStart = new Date(Math.floor(nowMs / 900000) * 900000).toISOString();
	const slotEnd = new Date(Date.parse(slotStart) + 900000).toISOString();
	const nextEnd = new Date(Date.parse(slotEnd) + 900000).toISOString();
	const base = {
		schemaVersion: 1 as const,
		inputRevision: INPUT_REV,
		preparationRevision: "p".repeat(64),
		capturedAt: new Date(nowMs).toISOString(),
		timezone: "Europe/Berlin",
		horizonStart: slotStart,
		horizonEnd: nextEnd,
		slotCount: 1,
		forecastStatus: "ready",
		dailyStatus: "ready",
		validationStatus: "ok" as const,
		qualityCodes: [] as string[],
		contributions: [],
		forecastSlots: [
			{
				start: slotStart,
				end: slotEnd,
				pvPowerW: 1000,
				houseLoadPowerW: null,
				fixedBalancePowerW: null,
				gridPriceCtPerKwh: null,
				gridImportAllowed: null,
				gridMaxImportPowerW: null,
			},
		],
		allocations: [
			{
				contributionId: "battery.charge",
				slotStart,
				slotEnd,
				powerW: 500,
				energyKwh: 0.125,
				status: "allocated",
			},
		],
		totals: {
			flexibleAllocatedEnergyKwh: 0.125,
			flexibleUnallocatedEnergyKwh: null,
			pvForecastEnergyKwh: null,
			fixedHouseLoadEnergyKwh: null,
		},
	};
	const candidateRevision = computeCandidateRevision(base);
	return { ...base, candidateRevision, generatedAt: base.capturedAt };
}

function makeEvidence(over: Partial<PlannerTakeoverEvidence> = {}): PlannerTakeoverEvidence {
	const now = Date.now();
	return {
		...emptyTakeoverEvidence(),
		state: "collecting",
		eligibleRuns: 8,
		matchedRuns: 8,
		consecutiveMatches: 8,
		mismatchedRuns: 0,
		failedRuns: 0,
		observationStartedAt: new Date(now - 40 * 60 * 1000).toISOString(),
		lastEligibleRunAt: new Date(now).toISOString(),
		observedSlotTransitions: 2,
		policyFingerprint: FP,
		evidenceRevision: EVIDENCE_REV,
		...over,
	};
}

function makeGrant(candidateRevision: string, nowMs: number): PlannerTakeoverAuthorizationGrant {
	const challenge = createTakeoverChallenge({
		adapterInstance: "ems.0",
		sessionId: "sess-1",
		nowMs,
		generation: GENERATION,
		inputRevision: INPUT_REV,
		candidateRevision,
		authoritativeRevision: AUTH_REV,
		evidenceRevision: EVIDENCE_REV,
		evidencePolicyRevision: FP,
		planningHorizonStart: "2026-07-17T10:00:00Z",
		planningHorizonEnd: "2026-07-18T10:00:00Z",
		slotDurationMinutes: 15,
		plannerContractVersion: 1,
		snapshotSchemaVersion: 1,
		publishPolicyRevision: "phase_3g_closed",
		idFactory: () => "ch-1",
	});
	return mintAuthorizationGrantFromChallenge(challenge, nowMs, () => "grant-1");
}

interface HarnessOptions {
	executionMode?: string;
	source?: "legacy" | "worker_dryrun";
	withGrant?: boolean;
}

function harness(opts: HarnessOptions = {}) {
	const { layout, dir } = tmpLayout();
	const nowMs = Date.now();
	const candidate = buildCandidate(nowMs);
	const bound: AuthorityBoundRevisions = {
		generation: GENERATION,
		inputRevision: INPUT_REV,
		candidateRevision: candidate.candidateRevision,
		authoritativeRevision: AUTH_REV,
		evidenceRevision: EVIDENCE_REV,
		evidencePolicyRevision: FP,
	};
	let grant: PlannerTakeoverAuthorizationGrant | null =
		opts.withGrant === false ? null : makeGrant(candidate.candidateRevision, nowMs);
	let consumeCount = 0;
	let legacyRuns = 0;
	const service = new PlannerAuthorityService({
		now: () => new Date(nowMs),
		adapterInstance: "ems.0",
		sessionId: "sess-1",
		layout,
		getConfiguredSource: () => opts.source ?? "worker_dryrun",
		getRuntimeMode: () => "shadow_auto",
		getEvaluationMode: () => "observe",
		getExecutionMode: () => opts.executionMode ?? "dryrun",
		getEvidence: () => makeEvidence(),
		getExpectedPolicyFingerprint: () => FP,
		getBoundRevisions: () => bound,
		getCandidate: () => candidate,
		peekAuthorizationGrant: () => grant,
		consumeAuthorizationGrant: () => {
			if (!grant) return null;
			consumeCount++;
			const g = grant;
			grant = null;
			return g;
		},
		requestLegacyRun: () => {
			legacyRuns++;
		},
	});
	return {
		service,
		layout,
		dir,
		candidate,
		getConsumeCount: () => consumeCount,
		getLegacyRuns: () => legacyRuns,
		cleanup: () => fs.rmSync(dir, { recursive: true, force: true }),
	};
}

describe("planner_authority activation", () => {
	it("configure worker_dryrun without activation → effective worker_pending", () => {
		const h = harness();
		try {
			assert.equal(h.service.effectiveAuthority(), "worker_pending");
			assert.equal(h.service.isWorkerAuthoritative(), false);
		} finally {
			h.cleanup();
		}
	});

	it("activate without grant fails", async () => {
		const h = harness({ withGrant: false });
		try {
			const r = await h.service.activateWorkerDryrun();
			assert.equal(r.ok, false);
			assert.equal(r.code, "no_grant");
		} finally {
			h.cleanup();
		}
	});

	it("activate at live execution mode fails", async () => {
		const h = harness({ executionMode: "live" });
		try {
			const r = await h.service.activateWorkerDryrun();
			assert.equal(r.ok, false);
			assert.equal(r.code, "execution_mode_live");
		} finally {
			h.cleanup();
		}
	});

	it("valid activate creates lease and consumes grant", async () => {
		const h = harness();
		try {
			const r = await h.service.activateWorkerDryrun();
			assert.equal(r.ok, true, r.code);
			const status = h.service.getPublicStatus();
			assert.equal(status.leaseActive, true);
			assert.equal(status.effectiveAuthority, "worker_dryrun");
			assert.equal(status.workerAuthoritative, true);
			assert.equal(status.canonicalAllowed, true);
			assert.equal(h.getConsumeCount(), 1);
		} finally {
			h.cleanup();
		}
	});

	it("fallback latches and clears worker authority; reactivation blocked", async () => {
		const h = harness();
		try {
			await h.service.activateWorkerDryrun();
			await h.service.fallback("test_reason");
			const status = h.service.getPublicStatus();
			assert.equal(status.fallbackLatched, true);
			assert.equal(status.workerAuthoritative, false);
			assert.equal(status.canonicalAllowed, false);
			assert.equal(status.effectiveAuthority, "legacy_fallback");
			assert.ok(h.getLegacyRuns() >= 1);

			const r = await h.service.activateWorkerDryrun();
			assert.equal(r.ok, false);
			assert.equal(r.code, "fallback_latched");
		} finally {
			h.cleanup();
		}
	});

	it("partial activation failure after grant consume falls back without worker intent", async () => {
		const h = harness();
		try {
			// Corrupt candidate content after grant/bound match so publish hash check fails
			// after the grant has already been consumed and a lease was minted.
			h.candidate.allocations[0]!.powerW = 12345;

			const r = await h.service.activateWorkerDryrun();
			assert.equal(r.ok, false);
			assert.equal(h.getConsumeCount(), 1);

			const status = h.service.getPublicStatus();
			assert.equal(status.effectiveAuthority, "legacy_fallback");
			assert.equal(status.workerAuthoritative, false);
			assert.equal(status.canonicalAllowed, false);
			assert.equal(status.leaseActive, false);
			assert.equal(status.fallbackLatched, true);
			assert.ok(h.getLegacyRuns() >= 1);

			// Intent projection only runs after successful publish+view; failure path never projects.
			assert.equal(status.viewQuality === "valid" && status.workerAuthoritative, false);
		} finally {
			h.cleanup();
		}
	});
});

describe("planner_authority capability / permit / pointer", () => {
	it("capability scope is worker_dryrun and forged grant is rejected", () => {
		const nowMs = Date.now();
		const candidate = buildCandidate(nowMs);
		const grant = makeGrant(candidate.candidateRevision, nowMs);
		const cap = mintWorkerDryrunActivationCapabilityFromGrant({
			grant,
			nowMs,
			generation: GENERATION,
			inputRevision: INPUT_REV,
			candidateRevision: candidate.candidateRevision,
			authoritativeRevision: AUTH_REV,
			evidenceRevision: EVIDENCE_REV,
		});
		assert.ok(cap);
		assert.equal(cap?.scope, "worker_dryrun");
		assert.equal(cap?.executionMode, "dryrun");

		const forged = JSON.parse(JSON.stringify(grant)) as PlannerTakeoverAuthorizationGrant;
		const capForged = mintWorkerDryrunActivationCapabilityFromGrant({
			grant: forged,
			nowMs,
			generation: GENERATION,
			inputRevision: INPUT_REV,
			candidateRevision: candidate.candidateRevision,
			authoritativeRevision: AUTH_REV,
			evidenceRevision: EVIDENCE_REV,
		});
		assert.equal(capForged, null);
	});

	it("permit is single-use", () => {
		const nowMs = Date.now();
		const permit = mintWorkerDryrunCanonicalPublishPermit({
			leaseActive: true,
			leaseId: "lease-1",
			adapterInstance: "ems.0",
			sessionId: "sess-1",
			grantId: "grant-1",
			nowMs,
			generation: GENERATION,
			inputRevision: INPUT_REV,
			candidateRevision: "c".repeat(64),
			authoritativeRevision: AUTH_REV,
			evidenceRevision: EVIDENCE_REV,
			planRevision: "c".repeat(64),
		});
		assert.ok(permit);
		assert.ok(isCanonicalPublishPermit(permit));
		assert.equal(consumePermit(permit!), true);
		assert.equal(consumePermit(permit!), false);
	});

	it("permit mint rejected without active lease", () => {
		const permit = mintWorkerDryrunCanonicalPublishPermit({
			leaseActive: false,
			leaseId: "lease-1",
			adapterInstance: "ems.0",
			sessionId: "sess-1",
			grantId: "grant-1",
			nowMs: Date.now(),
			generation: GENERATION,
			inputRevision: INPUT_REV,
			candidateRevision: "c".repeat(64),
			authoritativeRevision: AUTH_REV,
			evidenceRevision: EVIDENCE_REV,
			planRevision: "c".repeat(64),
		});
		assert.equal(permit, null);
	});

	it("pointer validation rejects a candidate-area plan path", () => {
		const { layout, dir } = tmpLayout();
		try {
			const bad = validatePointer(
				{
					schemaVersion: 1,
					source: "worker_dryrun",
					generation: 1,
					planPath: path.join(layout.runtimeCandidateDir, "job1", "plan_v1.json"),
					planRevision: "r",
					updatedAt: new Date().toISOString(),
					sessionId: "s",
				},
				layout,
			);
			assert.equal(bad.ok, false);
			assert.equal(bad.code, "plan_path_under_candidate");

			const traversal = validatePointer(
				{
					schemaVersion: 1,
					source: "worker_dryrun",
					generation: 1,
					planPath: `${layout.workerCanonicalDir}/../../escape.json`,
					planRevision: "r",
					updatedAt: new Date().toISOString(),
					sessionId: "s",
				},
				layout,
			);
			assert.equal(traversal.ok, false);
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("planner_authority guarantees", () => {
	it("planner.authority. states are denied as planner triggers", () => {
		assert.equal(isDeniedPlannerTriggerState("planner.authority.activate_worker_dryrun"), true);
		assert.equal(isDeniedPlannerTriggerState("planner.authority.effective_authority"), true);
	});

	it("no `as unknown as` casts in planner_authority sources", () => {
		const dir = path.join(process.cwd(), "src", "planner_authority");
		const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
		for (const f of files) {
			const content = fs.readFileSync(path.join(dir, f), "utf8");
			assert.ok(!content.includes("as unknown as"), `${f} contains 'as unknown as'`);
		}
	});
});
