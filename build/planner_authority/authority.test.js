"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const service_js_1 = require("./service.js");
const paths_js_1 = require("../planner_paths/paths.js");
const pointer_js_1 = require("./pointer.js");
const activation_js_1 = require("../planner_authorization/activation.js");
const permit_js_1 = require("../planner_publish/permit.js");
const grant_js_1 = require("../planner_authorization/grant.js");
const challenge_js_1 = require("../planner_authorization/challenge.js");
const types_js_1 = require("../planner_candidate/types.js");
const evidence_js_1 = require("../planner_takeover/evidence.js");
const constants_js_1 = require("../planner_takeover/constants.js");
const catalog_js_1 = require("../planner_trigger/catalog.js");
const FP = (0, evidence_js_1.policyFingerprint)(constants_js_1.DEFAULT_TAKEOVER_READINESS_POLICY);
const GENERATION = 7;
const INPUT_REV = "i".repeat(64);
const AUTH_REV = "a".repeat(64);
const EVIDENCE_REV = "erev-1";
function tmpLayout() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ems-authority-"));
    const layout = (0, paths_js_1.resolvePlannerPaths)({
        namespace: "ems.0",
        getAbsoluteInstanceDataDir: () => path.join(dir, "ems.0"),
    });
    return { layout, dir };
}
function buildCandidate(nowMs) {
    const slotStart = new Date(Math.floor(nowMs / 900000) * 900000).toISOString();
    const slotEnd = new Date(Date.parse(slotStart) + 900000).toISOString();
    const nextEnd = new Date(Date.parse(slotEnd) + 900000).toISOString();
    const base = {
        schemaVersion: 1,
        inputRevision: INPUT_REV,
        preparationRevision: "p".repeat(64),
        capturedAt: new Date(nowMs).toISOString(),
        timezone: "Europe/Berlin",
        horizonStart: slotStart,
        horizonEnd: nextEnd,
        slotCount: 1,
        forecastStatus: "ready",
        dailyStatus: "ready",
        validationStatus: "ok",
        qualityCodes: [],
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
    const candidateRevision = (0, types_js_1.computeCandidateRevision)(base);
    return { ...base, candidateRevision, generatedAt: base.capturedAt };
}
function makeEvidence(over = {}) {
    const now = Date.now();
    return {
        ...(0, evidence_js_1.emptyTakeoverEvidence)(),
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
function makeGrant(candidateRevision, nowMs) {
    const challenge = (0, challenge_js_1.createTakeoverChallenge)({
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
    return (0, grant_js_1.mintAuthorizationGrantFromChallenge)(challenge, nowMs, () => "grant-1");
}
function harness(opts = {}) {
    const { layout, dir } = tmpLayout();
    const nowMs = Date.now();
    const candidate = buildCandidate(nowMs);
    const bound = {
        generation: GENERATION,
        inputRevision: INPUT_REV,
        candidateRevision: candidate.candidateRevision,
        authoritativeRevision: AUTH_REV,
        evidenceRevision: EVIDENCE_REV,
        evidencePolicyRevision: FP,
    };
    let grant = opts.withGrant === false ? null : makeGrant(candidate.candidateRevision, nowMs);
    let consumeCount = 0;
    let legacyRuns = 0;
    const service = new service_js_1.PlannerAuthorityService({
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
            if (!grant)
                return null;
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
(0, node_test_1.describe)("planner_authority activation", () => {
    (0, node_test_1.it)("configure worker_dryrun without activation → effective worker_pending", () => {
        const h = harness();
        try {
            strict_1.default.equal(h.service.effectiveAuthority(), "worker_pending");
            strict_1.default.equal(h.service.isWorkerAuthoritative(), false);
        }
        finally {
            h.cleanup();
        }
    });
    (0, node_test_1.it)("activate without grant fails", async () => {
        const h = harness({ withGrant: false });
        try {
            const r = await h.service.activateWorkerDryrun();
            strict_1.default.equal(r.ok, false);
            strict_1.default.equal(r.code, "no_grant");
        }
        finally {
            h.cleanup();
        }
    });
    (0, node_test_1.it)("activate at live execution mode fails", async () => {
        const h = harness({ executionMode: "live" });
        try {
            const r = await h.service.activateWorkerDryrun();
            strict_1.default.equal(r.ok, false);
            strict_1.default.equal(r.code, "execution_mode_live");
        }
        finally {
            h.cleanup();
        }
    });
    (0, node_test_1.it)("valid activate creates lease and consumes grant", async () => {
        const h = harness();
        try {
            const r = await h.service.activateWorkerDryrun();
            strict_1.default.equal(r.ok, true, r.code);
            const status = h.service.getPublicStatus();
            strict_1.default.equal(status.leaseActive, true);
            strict_1.default.equal(status.effectiveAuthority, "worker_dryrun");
            strict_1.default.equal(status.workerAuthoritative, true);
            strict_1.default.equal(status.canonicalAllowed, true);
            strict_1.default.equal(h.getConsumeCount(), 1);
        }
        finally {
            h.cleanup();
        }
    });
    (0, node_test_1.it)("fallback latches and clears worker authority; reactivation blocked", async () => {
        const h = harness();
        try {
            await h.service.activateWorkerDryrun();
            await h.service.fallback("test_reason");
            const status = h.service.getPublicStatus();
            strict_1.default.equal(status.fallbackLatched, true);
            strict_1.default.equal(status.workerAuthoritative, false);
            strict_1.default.equal(status.canonicalAllowed, false);
            strict_1.default.equal(status.effectiveAuthority, "legacy_fallback");
            strict_1.default.ok(h.getLegacyRuns() >= 1);
            const r = await h.service.activateWorkerDryrun();
            strict_1.default.equal(r.ok, false);
            strict_1.default.equal(r.code, "fallback_latched");
        }
        finally {
            h.cleanup();
        }
    });
    (0, node_test_1.it)("partial activation failure after grant consume falls back without worker intent", async () => {
        const h = harness();
        try {
            // Corrupt candidate content after grant/bound match so publish hash check fails
            // after the grant has already been consumed and a lease was minted.
            h.candidate.allocations[0].powerW = 12345;
            const r = await h.service.activateWorkerDryrun();
            strict_1.default.equal(r.ok, false);
            strict_1.default.equal(h.getConsumeCount(), 1);
            const status = h.service.getPublicStatus();
            strict_1.default.equal(status.effectiveAuthority, "legacy_fallback");
            strict_1.default.equal(status.workerAuthoritative, false);
            strict_1.default.equal(status.canonicalAllowed, false);
            strict_1.default.equal(status.leaseActive, false);
            strict_1.default.equal(status.fallbackLatched, true);
            strict_1.default.ok(h.getLegacyRuns() >= 1);
            // Intent projection only runs after successful publish+view; failure path never projects.
            strict_1.default.equal(status.viewQuality === "valid" && status.workerAuthoritative, false);
        }
        finally {
            h.cleanup();
        }
    });
});
(0, node_test_1.describe)("planner_authority capability / permit / pointer", () => {
    (0, node_test_1.it)("capability scope is worker_dryrun and forged grant is rejected", () => {
        const nowMs = Date.now();
        const candidate = buildCandidate(nowMs);
        const grant = makeGrant(candidate.candidateRevision, nowMs);
        const cap = (0, activation_js_1.mintWorkerDryrunActivationCapabilityFromGrant)({
            grant,
            nowMs,
            generation: GENERATION,
            inputRevision: INPUT_REV,
            candidateRevision: candidate.candidateRevision,
            authoritativeRevision: AUTH_REV,
            evidenceRevision: EVIDENCE_REV,
        });
        strict_1.default.ok(cap);
        strict_1.default.equal(cap?.scope, "worker_dryrun");
        strict_1.default.equal(cap?.executionMode, "dryrun");
        const forged = JSON.parse(JSON.stringify(grant));
        const capForged = (0, activation_js_1.mintWorkerDryrunActivationCapabilityFromGrant)({
            grant: forged,
            nowMs,
            generation: GENERATION,
            inputRevision: INPUT_REV,
            candidateRevision: candidate.candidateRevision,
            authoritativeRevision: AUTH_REV,
            evidenceRevision: EVIDENCE_REV,
        });
        strict_1.default.equal(capForged, null);
    });
    (0, node_test_1.it)("permit is single-use", () => {
        const nowMs = Date.now();
        const permit = (0, permit_js_1.mintWorkerDryrunCanonicalPublishPermit)({
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
        strict_1.default.ok(permit);
        strict_1.default.ok((0, permit_js_1.isCanonicalPublishPermit)(permit));
        strict_1.default.equal((0, permit_js_1.consumePermit)(permit), true);
        strict_1.default.equal((0, permit_js_1.consumePermit)(permit), false);
    });
    (0, node_test_1.it)("permit mint rejected without active lease", () => {
        const permit = (0, permit_js_1.mintWorkerDryrunCanonicalPublishPermit)({
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
        strict_1.default.equal(permit, null);
    });
    (0, node_test_1.it)("pointer validation rejects a candidate-area plan path", () => {
        const { layout, dir } = tmpLayout();
        try {
            const bad = (0, pointer_js_1.validatePointer)({
                schemaVersion: 1,
                source: "worker_dryrun",
                generation: 1,
                planPath: path.join(layout.runtimeCandidateDir, "job1", "plan_v1.json"),
                planRevision: "r",
                updatedAt: new Date().toISOString(),
                sessionId: "s",
            }, layout);
            strict_1.default.equal(bad.ok, false);
            strict_1.default.equal(bad.code, "plan_path_under_candidate");
            const traversal = (0, pointer_js_1.validatePointer)({
                schemaVersion: 1,
                source: "worker_dryrun",
                generation: 1,
                planPath: `${layout.workerCanonicalDir}/../../escape.json`,
                planRevision: "r",
                updatedAt: new Date().toISOString(),
                sessionId: "s",
            }, layout);
            strict_1.default.equal(traversal.ok, false);
        }
        finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
(0, node_test_1.describe)("planner_authority guarantees", () => {
    (0, node_test_1.it)("planner.authority. states are denied as planner triggers", () => {
        strict_1.default.equal((0, catalog_js_1.isDeniedPlannerTriggerState)("planner.authority.activate_worker_dryrun"), true);
        strict_1.default.equal((0, catalog_js_1.isDeniedPlannerTriggerState)("planner.authority.effective_authority"), true);
    });
    (0, node_test_1.it)("no `as unknown as` casts in planner_authority sources", () => {
        const dir = path.join(process.cwd(), "src", "planner_authority");
        const files = fs.readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
        for (const f of files) {
            const content = fs.readFileSync(path.join(dir, f), "utf8");
            strict_1.default.ok(!content.includes("as unknown as"), `${f} contains 'as unknown as'`);
        }
    });
});
