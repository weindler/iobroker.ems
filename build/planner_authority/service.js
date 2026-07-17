"use strict";
/**
 * Planner worker-dryrun authority service — Phase 3H.
 * Owns the worker-dryrun lease, publish permits, the active authority pointer and
 * the deterministic legacy fallback. Never enables live execution.
 */
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerAuthorityService = void 0;
const activation_1 = require("../planner_authorization/activation");
const permit_1 = require("../planner_publish/permit");
const mutex_1 = require("./mutex");
const lease_1 = require("./lease");
const pilot_readiness_1 = require("./pilot_readiness");
const fallback_1 = require("./fallback");
const publish_1 = require("./publish");
const pointer_1 = require("./pointer");
const view_1 = require("./view");
class PlannerAuthorityService {
    deps;
    mutex = new mutex_1.AuthorityMutex();
    lease = null;
    openPermit = null;
    fallbackLatched = false;
    fallbackReason = null;
    workerCallbackActive = false;
    shuttingDown = false;
    lastEventCode = null;
    lastErrorCode = null;
    lastView = null;
    constructor(deps) {
        this.deps = deps;
    }
    nowMs() {
        return this.deps.now().getTime();
    }
    leaseActive() {
        return this.lease != null && !(0, lease_1.leaseExpired)(this.lease, this.nowMs());
    }
    effectiveAuthority() {
        if (this.fallbackLatched)
            return "legacy_fallback";
        if (this.deps.getConfiguredSource() !== "worker_dryrun")
            return "legacy";
        if (this.leaseActive())
            return "worker_dryrun";
        return "worker_pending";
    }
    isWorkerAuthoritative() {
        return this.effectiveAuthority() === "worker_dryrun";
    }
    shouldSkipLegacyAuthoritativeProjection() {
        return this.isWorkerAuthoritative();
    }
    shouldSkipRoutineDualRun() {
        return this.effectiveAuthority() === "worker_dryrun";
    }
    pilotReadiness() {
        const bound = this.deps.getBoundRevisions();
        const evidence = this.deps.getEvidence();
        const identityMatches = bound != null && evidence != null
            ? evidence.evidenceRevision === bound.evidenceRevision
            : false;
        return (0, pilot_readiness_1.evaluateDryrunPilotReadiness)({
            evaluationObserving: this.deps.getEvaluationMode() === "observe",
            evidence,
            nowMs: this.nowMs(),
            expectedPolicyFingerprint: this.deps.getExpectedPolicyFingerprint(),
            identityMatches,
        });
    }
    getPublicStatus() {
        const pilot = this.pilotReadiness();
        const effective = this.effectiveAuthority();
        const workerAuth = effective === "worker_dryrun" && this.leaseActive();
        return {
            configuredSource: this.deps.getConfiguredSource(),
            effectiveAuthority: effective,
            workerAuthoritative: workerAuth,
            canonicalAllowed: workerAuth,
            dryrunPilotState: pilot.state,
            dryrunPilotPrimaryCode: pilot.primaryCode,
            leaseActive: this.leaseActive(),
            leaseExpiresAt: this.lease?.expiresAt ?? null,
            fallbackLatched: this.fallbackLatched,
            fallbackReason: this.fallbackReason,
            viewQuality: this.lastView?.quality ?? null,
            planRevision: this.lastView?.planRevision ?? null,
            generation: this.lastView?.generation ?? this.lease?.generation ?? null,
            lastEventCode: this.lastEventCode,
            lastErrorCode: this.lastErrorCode,
        };
    }
    async getView(refresh = true) {
        this.lastView = await (0, view_1.getActiveAuthoritativePlannerView)({
            layout: this.deps.layout,
            nowMs: this.nowMs(),
            refresh,
        });
        return this.lastView;
    }
    async activateWorkerDryrun() {
        return this.mutex.runExclusive(async () => {
            if (this.shuttingDown)
                return this.fail("shutdown");
            if (this.deps.getConfiguredSource() !== "worker_dryrun")
                return this.fail("source_not_worker_dryrun");
            if (this.fallbackLatched)
                return this.fail("fallback_latched");
            if (this.deps.getRuntimeMode() !== "shadow_auto")
                return this.fail("runtime_mode_not_auto");
            if (this.deps.getEvaluationMode() !== "observe")
                return this.fail("evaluation_not_observe");
            if (this.deps.getExecutionMode() === "live")
                return this.fail("execution_mode_live");
            if (this.leaseActive())
                return this.fail("already_active");
            const pilot = this.pilotReadiness();
            const evidence = this.deps.getEvidence();
            const fullReady = evidence?.state === "ready";
            // Inclusive OR — never XOR: full evidence ready OR dryrun pilot ready.
            const takeoverReady = fullReady || pilot.state === "ready";
            if (!takeoverReady) {
                return this.fail(pilot.primaryCode ?? "pilot_not_ready");
            }
            const bound = this.deps.getBoundRevisions();
            if (!bound)
                return this.fail("missing_bound_revisions");
            const grant = this.deps.peekAuthorizationGrant();
            if (!grant)
                return this.fail("no_grant");
            if (grant.generation !== bound.generation ||
                grant.inputRevision !== bound.inputRevision ||
                grant.candidateRevision !== bound.candidateRevision ||
                grant.authoritativeRevision !== bound.authoritativeRevision ||
                grant.evidenceRevision !== bound.evidenceRevision) {
                return this.fail("grant_revision_mismatch");
            }
            const candidate = this.deps.getCandidate();
            if (!candidate)
                return this.fail("no_candidate");
            if (candidate.candidateRevision !== bound.candidateRevision)
                return this.fail("candidate_revision_mismatch");
            const consumed = this.deps.consumeAuthorizationGrant();
            if (!consumed)
                return this.fail("grant_consume_failed");
            const nowMs = this.nowMs();
            const capability = (0, activation_1.mintWorkerDryrunActivationCapabilityFromGrant)({
                grant: consumed,
                nowMs,
                generation: bound.generation,
                inputRevision: bound.inputRevision,
                candidateRevision: bound.candidateRevision,
                authoritativeRevision: bound.authoritativeRevision,
                evidenceRevision: bound.evidenceRevision,
            });
            if (!capability)
                return this.fail("capability_mint_failed");
            const lease = (0, lease_1.mintWorkerDryrunAuthorityLease)({ capability, nowMs });
            if (!lease)
                return this.fail("lease_mint_failed");
            this.lease = lease;
            try {
                await this.publishCandidate(candidate, lease, nowMs);
            }
            catch (e) {
                const code = e instanceof publish_1.WorkerPublishError ? e.code : "publish_failed";
                this.lease = null;
                await this.fallbackInternal(`activate_publish_failed:${code}`);
                return { ok: false, code };
            }
            this.workerCallbackActive = true;
            this.lastEventCode = "worker_dryrun_activated";
            this.lastErrorCode = null;
            await this.getView(true);
            await this.projectIntentIfPossible();
            this.emitStatus();
            return { ok: true, code: "worker_dryrun_activated" };
        });
    }
    async publishCandidate(candidate, lease, nowMs) {
        if (!(0, lease_1.isWorkerDryrunAuthorityLease)(lease) || (0, lease_1.leaseExpired)(lease, nowMs)) {
            throw new publish_1.WorkerPublishError("lease_invalid");
        }
        const permit = (0, permit_1.mintWorkerDryrunCanonicalPublishPermit)({
            leaseActive: true,
            leaseId: lease.leaseId,
            adapterInstance: lease.adapterInstance,
            sessionId: lease.sessionId,
            grantId: lease.grantId,
            nowMs,
            generation: lease.generation,
            inputRevision: lease.inputRevision,
            candidateRevision: candidate.candidateRevision,
            authoritativeRevision: lease.authoritativeRevision,
            evidenceRevision: lease.evidenceRevision,
            planRevision: candidate.candidateRevision,
        });
        if (!permit)
            throw new publish_1.WorkerPublishError("permit_mint_failed");
        this.openPermit = permit;
        const result = await (0, publish_1.publishWorkerCanonicalFromCandidate)({
            candidate,
            generation: lease.generation,
            layout: this.deps.layout,
            permit,
            nowMs,
        });
        this.openPermit = null;
        await (0, pointer_1.writeWorkerPointer)(this.deps.layout, {
            generation: lease.generation,
            planPath: result.planPath,
            planRevision: result.planRevision,
            sessionId: this.deps.sessionId,
            nowMs,
        });
    }
    async deactivateWorker() {
        return this.mutex.runExclusive(async () => {
            this.clearLeaseAndPermit();
            this.workerCallbackActive = false;
            this.fallbackReason = null;
            // Conscious revoke — no latch.
            await (0, pointer_1.writeLegacyPointer)(this.deps.layout, {
                generation: this.deps.getBoundRevisions()?.generation ?? 0,
                sessionId: this.deps.sessionId,
                nowMs: this.nowMs(),
            }).catch(() => undefined);
            this.lastEventCode = "worker_deactivated";
            await this.getView(true).catch(() => undefined);
            this.emitStatus();
            return { ok: true, code: "worker_deactivated" };
        });
    }
    async onWorkerJobSuccess(candidate, _jobId) {
        return this.mutex.runExclusive(async () => {
            if (!this.workerCallbackActive || !this.leaseActive() || this.fallbackLatched)
                return;
            const lease = this.lease;
            if (!lease)
                return;
            const nowMs = this.nowMs();
            try {
                await this.publishCandidate(candidate, lease, nowMs);
                this.lastEventCode = "worker_job_published";
                await this.getView(true);
                await this.projectIntentIfPossible();
                this.emitStatus();
            }
            catch (e) {
                const code = e instanceof publish_1.WorkerPublishError ? e.code : "publish_failed";
                await this.fallbackInternal(`worker_job_publish_failed:${code}`);
            }
        });
    }
    async fallback(reason) {
        return this.mutex.runExclusive(async () => {
            await this.fallbackInternal(reason);
        });
    }
    async fallbackInternal(reason) {
        await (0, fallback_1.performLegacyFallback)({
            layout: this.deps.layout,
            generation: this.deps.getBoundRevisions()?.generation ?? this.lease?.generation ?? 0,
            sessionId: this.deps.sessionId,
            nowMs: this.nowMs(),
            setLatch: (r) => {
                this.fallbackLatched = true;
                this.fallbackReason = r;
                this.lastErrorCode = r;
            },
            invalidateLeaseAndPermits: () => this.clearLeaseAndPermit(),
            stopWorkerCallback: () => {
                this.workerCallbackActive = false;
            },
            requestLegacyRun: (r) => this.deps.requestLegacyRun(r),
            writeStatus: () => this.emitStatus(),
        }, reason);
        this.lastEventCode = "legacy_fallback";
        await this.getView(true).catch(() => undefined);
        this.emitStatus();
    }
    async onExecutionModeChange(mode) {
        if (mode !== "dryrun") {
            await this.fallback(mode === "live" ? "execution_mode_live" : "execution_mode_not_dryrun");
        }
    }
    async onConfiguredSourceChange() {
        return this.mutex.runExclusive(async () => {
            if (this.deps.getConfiguredSource() !== "worker_dryrun") {
                this.clearLeaseAndPermit();
                this.workerCallbackActive = false;
                await (0, pointer_1.writeLegacyPointer)(this.deps.layout, {
                    generation: this.deps.getBoundRevisions()?.generation ?? 0,
                    sessionId: this.deps.sessionId,
                    nowMs: this.nowMs(),
                }).catch(() => undefined);
            }
            this.emitStatus();
        });
    }
    async shutdown() {
        return this.mutex.runExclusive(async () => {
            this.shuttingDown = true;
            this.clearLeaseAndPermit();
            this.workerCallbackActive = false;
            // Leave a clean legacy pointer — leases are never persisted.
            await (0, pointer_1.writeLegacyPointer)(this.deps.layout, {
                generation: this.deps.getBoundRevisions()?.generation ?? 0,
                sessionId: this.deps.sessionId,
                nowMs: this.nowMs(),
            }).catch(() => undefined);
            this.emitStatus();
        });
    }
    async projectIntentIfPossible() {
        const host = this.deps.getStateHost?.() ?? null;
        if (!host || !this.lastView)
            return;
        try {
            const { projectWorkerViewToIntentStates } = await Promise.resolve().then(() => __importStar(require("./project_intent.js")));
            await projectWorkerViewToIntentStates(host, {
                view: this.lastView,
                now: this.deps.now(),
                timezone: "Europe/Berlin",
                globalMode: "balanced",
                slotMinutes: 15,
            });
        }
        catch {
            // projection failures must not break authority
        }
    }
    clearLeaseAndPermit() {
        if (this.openPermit)
            (0, permit_1.consumePermit)(this.openPermit);
        this.openPermit = null;
        this.lease = null;
    }
    fail(code) {
        this.lastErrorCode = code;
        this.lastEventCode = "activate_rejected";
        this.emitStatus();
        return { ok: false, code };
    }
    emitStatus() {
        this.deps.onStatus?.(this.getPublicStatus());
    }
}
exports.PlannerAuthorityService = PlannerAuthorityService;
