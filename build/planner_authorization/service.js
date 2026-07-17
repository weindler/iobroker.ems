"use strict";
/**
 * Planner takeover authorization service — Phase 3G ceremony.
 * Ends at activation_blocked; never mints CanonicalPublishPermit.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PlannerAuthorizationService = void 0;
const evidence_1 = require("../planner_takeover/evidence");
const constants_1 = require("../planner_takeover/constants");
const constants_2 = require("./constants");
const challenge_1 = require("./challenge");
const eligibility_1 = require("./eligibility");
const grant_1 = require("./grant");
const mutex_1 = require("./mutex");
const replay_1 = require("./replay");
const permit_preview_1 = require("./permit_preview");
const state_machine_1 = require("./state_machine");
const audit_io_1 = require("./audit_io");
class PlannerAuthorizationService {
    deps;
    state = "disabled";
    challenge = null;
    grant = null;
    mutex = new mutex_1.AuthorizationMutex();
    replay = new replay_1.ChallengeReplayCache();
    audit = (0, audit_io_1.emptyAuditFile)();
    challengeTimer = null;
    grantTimer = null;
    shuttingDown = false;
    lastEventCode = null;
    lastErrorCode = null;
    auditLoaded = false;
    constructor(deps) {
        this.deps = deps;
    }
    getPublicStatus() {
        const configured = this.deps.getAuthorizationMode();
        const effective = configured === "manual_prepare" &&
            this.deps.getRuntimeMode() === "shadow_auto" &&
            this.deps.getEvaluationMode() === "observe"
            ? "manual_prepare"
            : "disabled";
        const elig = this.computeEligibility();
        return {
            configuredMode: configured,
            effectiveMode: effective,
            state: effective === "disabled" && this.state !== "disabled" ? "disabled" : this.state,
            eligible: elig.eligible,
            primaryBlockReason: elig.primaryCode,
            blockReasonCount: elig.codes.length,
            challengeId: this.challenge && !this.challenge.consumed ? this.challenge.challengeId : null,
            challengeCreatedAt: this.challenge?.createdAt ?? null,
            challengeExpiresAt: this.challenge?.expiresAt ?? null,
            confirmFailures: this.challenge?.confirmFailures ?? 0,
            grantActive: this.grant != null && !(0, grant_1.grantExpired)(this.grant, this.deps.now().getTime()),
            grantCreatedAt: this.grant?.issuedAt ?? null,
            grantExpiresAt: this.grant?.expiresAt ?? null,
            revisionMatch: this.revisionsMatchActive(),
            activationCapabilityPresent: false,
            permitMinted: false,
            canonicalAllowed: false,
            lastEventCode: this.lastEventCode,
            lastErrorCode: this.lastErrorCode,
        };
    }
    async syncFromConfig() {
        return this.mutex.runExclusive(async () => {
            const mode = this.deps.getAuthorizationMode();
            const effective = mode === "manual_prepare" &&
                this.deps.getRuntimeMode() === "shadow_auto" &&
                this.deps.getEvaluationMode() === "observe";
            if (!effective) {
                this.clearChallengeAndGrant("authorization_disabled");
                this.setState("disabled");
                await this.auditEvent("authorization_disabled", "ok");
            }
            else if (this.state === "disabled") {
                this.setState("idle");
                await this.auditEvent("authorization_enabled", "ok");
            }
            this.emitStatus();
        });
    }
    async prepare() {
        return this.mutex.runExclusive(async () => {
            if (this.shuttingDown)
                return this.reject("prepare_rejected", "shutdown");
            await this.auditEvent("prepare_requested", "requested");
            const mode = this.deps.getAuthorizationMode();
            if (mode !== "manual_prepare")
                return this.reject("prepare_rejected", "authorization_disabled");
            if (this.challenge && !(0, challenge_1.challengeExpired)(this.challenge, this.nowMs()) && !this.challenge.consumed) {
                return this.reject("prepare_rejected", "challenge_active");
            }
            if (this.grant && !(0, grant_1.grantExpired)(this.grant, this.nowMs())) {
                return this.reject("prepare_rejected", "grant_active");
            }
            const elig = this.computeEligibility();
            if (!elig.eligible) {
                this.setState("ineligible");
                this.lastErrorCode = elig.primaryCode;
                await this.auditEvent("prepare_rejected", elig.primaryCode ?? "ineligible");
                this.emitStatus();
                return { ok: false, code: elig.primaryCode ?? "ineligible" };
            }
            const bound = this.deps.getEligibilityExtras().bound;
            if (!bound) {
                this.setState("ineligible");
                return this.reject("prepare_rejected", "missing_input_revision");
            }
            const challenge = (0, challenge_1.createTakeoverChallenge)({
                adapterInstance: this.deps.adapterInstance,
                sessionId: this.deps.sessionId,
                nowMs: this.nowMs(),
                ...bound,
                idFactory: this.deps.idFactory,
            });
            this.challenge = challenge;
            this.grant = null;
            this.setState("prepared");
            this.armChallengeTimer(challenge);
            await this.auditEvent("challenge_created", "ok", challenge.challengeId, null);
            this.emitStatus();
            return { ok: true, code: "challenge_created" };
        });
    }
    async confirm(challengeId) {
        return this.mutex.runExclusive(async () => {
            if (this.shuttingDown)
                return this.reject("confirm_rejected", "shutdown");
            await this.auditEvent("confirm_requested", "requested", challengeId, null);
            const challenge = this.challenge;
            if (!challenge)
                return this.reject("confirm_rejected", "challenge_active");
            if (challenge.consumed || this.replay.has(challenge.challengeId, this.nowMs())) {
                return this.reject("confirm_rejected", "challenge_active");
            }
            if ((0, challenge_1.challengeExpired)(challenge, this.nowMs())) {
                this.clearChallengeAndGrant("expired");
                this.setState("expired");
                await this.auditEvent("challenge_expired", "expired", challenge.challengeId, null);
                this.emitStatus();
                return { ok: false, code: "challenge_expired" };
            }
            if (challenge.challengeId !== challengeId) {
                challenge.confirmFailures += 1;
                if (challenge.confirmFailures >= constants_2.TAKEOVER_MAX_CONFIRM_FAILURES) {
                    this.clearChallengeAndGrant("invalidated");
                    this.setState("invalidated");
                    await this.auditEvent("challenge_invalidated", "confirm_failures", challenge.challengeId, null);
                    this.emitStatus();
                    return { ok: false, code: "challenge_invalidated" };
                }
                this.lastErrorCode = "confirm_id_mismatch";
                await this.auditEvent("confirm_rejected", "confirm_id_mismatch", challengeId, null);
                this.emitStatus();
                return { ok: false, code: "confirm_id_mismatch" };
            }
            if (challenge.sessionId !== this.deps.sessionId) {
                return this.reject("confirm_rejected", "challenge_invalidated");
            }
            const elig = this.computeEligibilityForConfirm(challenge);
            if (!elig.eligible) {
                this.clearChallengeAndGrant("invalidated");
                this.setState("invalidated");
                await this.auditEvent("challenge_invalidated", elig.primaryCode ?? "ineligible", challenge.challengeId, null);
                this.emitStatus();
                return { ok: false, code: elig.primaryCode ?? "ineligible" };
            }
            if (!this.revisionsMatchChallenge(challenge)) {
                this.clearChallengeAndGrant("invalidated");
                this.setState("invalidated");
                await this.auditEvent("challenge_invalidated", "revision_mismatch", challenge.challengeId, null);
                this.emitStatus();
                return { ok: false, code: "revision_mismatch" };
            }
            challenge.consumed = true;
            this.replay.remember(challenge.challengeId, Date.parse(challenge.expiresAt) + constants_2.TAKEOVER_AUTHORIZATION_GRANT_TTL_MS);
            const grant = (0, grant_1.mintAuthorizationGrantFromChallenge)(challenge, this.nowMs(), this.deps.idFactory);
            this.grant = grant;
            this.challenge = null;
            this.clearChallengeTimer();
            this.setState("confirmed");
            this.setState("activation_blocked");
            this.armGrantTimer(grant);
            await this.auditEvent("grant_created", "ok", challenge.challengeId, grant.grantId);
            await this.auditEvent("activation_blocked", "activation_capability_missing", null, grant.grantId);
            const preview = this.previewPermitMint();
            await this.auditEvent("permit_preview_evaluated", preview.primaryBlockReason ?? "activation_blocked", null, grant.grantId);
            this.emitStatus();
            return { ok: true, code: "activation_blocked" };
        });
    }
    async cancel() {
        return this.mutex.runExclusive(async () => {
            const had = this.challenge != null || this.grant != null;
            this.clearChallengeAndGrant("cancelled");
            this.setState("cancelled");
            this.setState("idle");
            await this.auditEvent("cancelled", had ? "ok" : "idempotent");
            this.emitStatus();
            return { ok: true, code: "cancelled" };
        });
    }
    async invalidate(reason) {
        return this.mutex.runExclusive(async () => {
            if (!this.challenge && !this.grant && (this.state === "idle" || this.state === "disabled")) {
                return;
            }
            const cId = this.challenge?.challengeId ?? null;
            const gId = this.grant?.grantId ?? null;
            this.clearChallengeAndGrant("invalidated");
            this.setState("invalidated");
            this.setState(this.deps.getAuthorizationMode() === "manual_prepare" ? "idle" : "disabled");
            await this.auditEvent("grant_invalidated", reason, cId, gId);
            this.emitStatus();
        });
    }
    previewPermitMint() {
        const evidence = this.deps.getEvidence();
        return (0, permit_preview_1.evaluateCanonicalPermitMintPreview)({
            authorizationState: this.state,
            grant: this.grant,
            nowMs: this.nowMs(),
            evidenceReady: evidence?.state === "ready",
            revisionMatch: this.revisionsMatchActive(),
            executionModeDryrun: this.deps.getEligibilityExtras().executionMode !== "live",
            releaseGateClosed: true,
        });
    }
    async shutdown() {
        return this.mutex.runExclusive(async () => {
            this.shuttingDown = true;
            const cId = this.challenge?.challengeId ?? null;
            const gId = this.grant?.grantId ?? null;
            this.clearChallengeAndGrant("shutdown");
            this.replay.clear();
            this.setState("disabled");
            await this.auditEvent("shutdown_invalidated", "shutdown", cId, gId);
            this.emitStatus();
        });
    }
    computeEligibility() {
        const extras = this.deps.getEligibilityExtras();
        const evidence = this.deps.getEvidence();
        const input = {
            nowMs: this.nowMs(),
            adapterReady: extras.adapterReady !== false,
            shuttingDown: this.shuttingDown || extras.shuttingDown === true,
            restoreBarrierActive: extras.restoreBarrierActive === true,
            operationLockActive: extras.operationLockActive === true,
            plannerRuntimeMode: this.deps.getRuntimeMode(),
            evaluationMode: this.deps.getEvaluationMode(),
            authorizationMode: this.deps.getAuthorizationMode(),
            evidence,
            expectedEvidenceSchemaVersion: constants_1.TAKEOVER_EVIDENCE_SCHEMA_VERSION,
            expectedPolicyFingerprint: (0, evidence_1.policyFingerprint)(constants_1.DEFAULT_TAKEOVER_READINESS_POLICY),
            lastCompareStatus: extras.lastCompareStatus,
            authoritativeRevision: extras.authoritativeRevision,
            candidateRevision: extras.candidateRevision,
            inputRevision: extras.inputRevision,
            generationMatches: extras.generationMatches,
            horizonMatches: extras.horizonMatches,
            candidateValid: extras.candidateValid,
            authoritativePublishOk: extras.authoritativePublishOk,
            plannerJobActive: extras.plannerJobActive === true,
            pendingRerun: extras.pendingRerun === true,
            executionMode: extras.executionMode ?? "dryrun",
            challengeActive: this.challenge != null && !this.challenge.consumed && !(0, challenge_1.challengeExpired)(this.challenge, this.nowMs()),
            grantActive: this.grant != null && !(0, grant_1.grantExpired)(this.grant, this.nowMs()),
            releaseGateClosed: true,
        };
        return (0, eligibility_1.evaluateAuthorizationEligibility)(input);
    }
    computeEligibilityForConfirm(challenge) {
        // Confirm must not see challenge_active / grant_active as blockers for the challenge being confirmed.
        const extras = this.deps.getEligibilityExtras();
        const evidence = this.deps.getEvidence();
        return (0, eligibility_1.evaluateAuthorizationEligibility)({
            nowMs: this.nowMs(),
            adapterReady: extras.adapterReady !== false,
            shuttingDown: this.shuttingDown || extras.shuttingDown === true,
            restoreBarrierActive: extras.restoreBarrierActive === true,
            operationLockActive: extras.operationLockActive === true,
            plannerRuntimeMode: this.deps.getRuntimeMode(),
            evaluationMode: this.deps.getEvaluationMode(),
            authorizationMode: this.deps.getAuthorizationMode(),
            evidence,
            expectedEvidenceSchemaVersion: constants_1.TAKEOVER_EVIDENCE_SCHEMA_VERSION,
            expectedPolicyFingerprint: (0, evidence_1.policyFingerprint)(constants_1.DEFAULT_TAKEOVER_READINESS_POLICY),
            lastCompareStatus: extras.lastCompareStatus,
            authoritativeRevision: extras.authoritativeRevision,
            candidateRevision: extras.candidateRevision,
            inputRevision: extras.inputRevision,
            generationMatches: extras.generationMatches && extras.bound?.generation === challenge.generation,
            horizonMatches: extras.horizonMatches,
            candidateValid: extras.candidateValid,
            authoritativePublishOk: extras.authoritativePublishOk,
            plannerJobActive: extras.plannerJobActive === true,
            pendingRerun: extras.pendingRerun === true,
            executionMode: extras.executionMode ?? "dryrun",
            challengeActive: false,
            grantActive: false,
            releaseGateClosed: true,
        });
    }
    revisionsMatchChallenge(challenge) {
        const bound = this.deps.getEligibilityExtras().bound;
        if (!bound)
            return false;
        return (bound.generation === challenge.generation &&
            bound.inputRevision === challenge.inputRevision &&
            bound.candidateRevision === challenge.candidateRevision &&
            bound.authoritativeRevision === challenge.authoritativeRevision &&
            bound.evidenceRevision === challenge.evidenceRevision &&
            bound.evidencePolicyRevision === challenge.evidencePolicyRevision &&
            bound.planningHorizonStart === challenge.planningHorizonStart &&
            bound.planningHorizonEnd === challenge.planningHorizonEnd &&
            bound.slotDurationMinutes === challenge.slotDurationMinutes &&
            bound.publishPolicyRevision === challenge.publishPolicyRevision);
    }
    revisionsMatchActive() {
        if (this.grant) {
            const bound = this.deps.getEligibilityExtras().bound;
            if (!bound)
                return false;
            return (bound.generation === this.grant.generation &&
                bound.inputRevision === this.grant.inputRevision &&
                bound.candidateRevision === this.grant.candidateRevision &&
                bound.authoritativeRevision === this.grant.authoritativeRevision);
        }
        if (this.challenge)
            return this.revisionsMatchChallenge(this.challenge);
        return true;
    }
    setState(to) {
        const result = (0, state_machine_1.tryTransitionAuthorizationState)(this.state, to);
        if (result.ok)
            this.state = result.state;
    }
    clearChallengeAndGrant(_reason) {
        this.clearChallengeTimer();
        this.clearGrantTimer();
        this.challenge = null;
        this.grant = null;
    }
    armChallengeTimer(challenge) {
        this.clearChallengeTimer();
        const delay = Math.max(0, Date.parse(challenge.expiresAt) - this.nowMs());
        this.challengeTimer = setTimeout(() => {
            void this.mutex.runExclusive(async () => {
                if (this.challenge?.challengeId !== challenge.challengeId)
                    return;
                this.clearChallengeAndGrant("expired");
                this.setState("expired");
                this.setState("idle");
                await this.auditEvent("challenge_expired", "expired", challenge.challengeId, null);
                this.emitStatus();
            });
        }, delay);
        if (typeof this.challengeTimer === "object" && "unref" in this.challengeTimer) {
            this.challengeTimer.unref?.();
        }
    }
    armGrantTimer(grant) {
        this.clearGrantTimer();
        const delay = Math.max(0, Date.parse(grant.expiresAt) - this.nowMs());
        this.grantTimer = setTimeout(() => {
            void this.mutex.runExclusive(async () => {
                if (this.grant?.grantId !== grant.grantId)
                    return;
                this.clearChallengeAndGrant("expired");
                this.setState("expired");
                this.setState("idle");
                await this.auditEvent("grant_expired", "expired", null, grant.grantId);
                this.emitStatus();
            });
        }, delay);
        if (typeof this.grantTimer === "object" && "unref" in this.grantTimer) {
            this.grantTimer.unref?.();
        }
    }
    clearChallengeTimer() {
        if (this.challengeTimer)
            clearTimeout(this.challengeTimer);
        this.challengeTimer = null;
    }
    clearGrantTimer() {
        if (this.grantTimer)
            clearTimeout(this.grantTimer);
        this.grantTimer = null;
    }
    nowMs() {
        return this.deps.now().getTime();
    }
    async reject(event, code) {
        this.lastErrorCode = code;
        await this.auditEvent(event, code);
        this.emitStatus();
        return { ok: false, code };
    }
    async auditEvent(eventCode, resultCode, challengeId, grantId) {
        this.lastEventCode = eventCode;
        if (!this.deps.auditDir)
            return;
        try {
            if (!this.auditLoaded) {
                this.audit = await (0, audit_io_1.readAuthorizationAuditFile)(this.deps.auditDir);
                this.auditLoaded = true;
            }
            const extras = this.deps.getEligibilityExtras();
            this.audit = (0, audit_io_1.appendAuditEntry)(this.audit, {
                timestamp: this.deps.now().toISOString(),
                eventCode,
                resultCode,
                challengeIdShort: (0, challenge_1.shortenId)(challengeId),
                grantIdShort: (0, challenge_1.shortenId)(grantId),
                generation: extras.bound?.generation ?? null,
                inputRevisionShort: (0, challenge_1.shortenId)(extras.inputRevision, 12),
                candidateRevisionShort: (0, challenge_1.shortenId)(extras.candidateRevision, 12),
                authoritativeRevisionShort: (0, challenge_1.shortenId)(extras.authoritativeRevision, 12),
                evidenceRevisionShort: (0, challenge_1.shortenId)(this.deps.getEvidence()?.evidenceRevision, 12),
                sessionIdShort: (0, challenge_1.shortenId)(this.deps.sessionId, 8) ?? "unknown",
            });
            await (0, audit_io_1.writeAuthorizationAuditAtomic)(this.deps.auditDir, this.audit);
        }
        catch {
            // audit failures isolated
        }
    }
    emitStatus() {
        this.deps.onStatus?.(this.getPublicStatus());
    }
}
exports.PlannerAuthorizationService = PlannerAuthorizationService;
