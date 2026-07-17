/**
 * Planner takeover authorization service — Phase 3G ceremony.
 * Ends at activation_blocked; never mints CanonicalPublishPermit.
 */

import type { PlannerRuntimeMode } from "../planner_config";
import type { PlannerTakeoverEvaluationMode } from "../planner_config/evaluation_mode";
import type { PlannerTakeoverAuthorizationMode } from "../planner_config/authorization_mode";
import type { PlannerTakeoverEvidence } from "../planner_takeover/types";
import { policyFingerprint } from "../planner_takeover/evidence";
import {
	DEFAULT_TAKEOVER_READINESS_POLICY,
	TAKEOVER_EVIDENCE_SCHEMA_VERSION,
} from "../planner_takeover/constants";
import { TAKEOVER_MAX_CONFIRM_FAILURES, TAKEOVER_AUTHORIZATION_GRANT_TTL_MS } from "./constants";
import { createTakeoverChallenge, challengeExpired, shortenId, type ChallengeIdFactory } from "./challenge";
import { evaluateAuthorizationEligibility, type AuthorizationEligibilityInput } from "./eligibility";
import {
	mintAuthorizationGrantFromChallenge,
	grantExpired,
	type PlannerTakeoverAuthorizationGrant,
} from "./grant";
import { AuthorizationMutex } from "./mutex";
import { ChallengeReplayCache } from "./replay";
import { evaluateCanonicalPermitMintPreview } from "./permit_preview";
import { tryTransitionAuthorizationState } from "./state_machine";
import {
	appendAuditEntry,
	emptyAuditFile,
	readAuthorizationAuditFile,
	writeAuthorizationAuditAtomic,
	type AuthorizationAuditFile,
} from "./audit_io";
import type {
	PlannerAuthorizationPublicStatus,
	PlannerAuthorizationState,
	PlannerTakeoverChallenge,
	CanonicalPermitMintPreview,
} from "./types";

export interface AuthorizationBoundRevisions {
	generation: number;
	inputRevision: string;
	candidateRevision: string;
	authoritativeRevision: string;
	evidenceRevision: string;
	evidencePolicyRevision: string;
	planningHorizonStart: string;
	planningHorizonEnd: string;
	slotDurationMinutes: number;
	plannerContractVersion: number;
	snapshotSchemaVersion: number;
	publishPolicyRevision: string;
}

export interface AuthorizationServiceDeps {
	now: () => Date;
	adapterInstance: string;
	sessionId: string;
	auditDir: string | null;
	idFactory?: ChallengeIdFactory;
	getRuntimeMode: () => PlannerRuntimeMode;
	getEvaluationMode: () => PlannerTakeoverEvaluationMode;
	getAuthorizationMode: () => PlannerTakeoverAuthorizationMode;
	getEvidence: () => PlannerTakeoverEvidence | null;
	getEligibilityExtras: () => Partial<AuthorizationEligibilityInput> & {
		lastCompareStatus: string | null;
		authoritativeRevision: string | null;
		candidateRevision: string | null;
		inputRevision: string | null;
		generationMatches: boolean;
		horizonMatches: boolean;
		candidateValid: boolean;
		authoritativePublishOk: boolean;
		bound?: AuthorizationBoundRevisions | null;
	};
	onStatus?: (status: PlannerAuthorizationPublicStatus) => void;
}

export class PlannerAuthorizationService {
	private state: PlannerAuthorizationState = "disabled";
	private challenge: PlannerTakeoverChallenge | null = null;
	private grant: PlannerTakeoverAuthorizationGrant | null = null;
	private readonly mutex = new AuthorizationMutex();
	private readonly replay = new ChallengeReplayCache();
	private audit: AuthorizationAuditFile = emptyAuditFile();
	private challengeTimer: ReturnType<typeof setTimeout> | null = null;
	private grantTimer: ReturnType<typeof setTimeout> | null = null;
	private shuttingDown = false;
	private lastEventCode: string | null = null;
	private lastErrorCode: string | null = null;
	private auditLoaded = false;

	constructor(private readonly deps: AuthorizationServiceDeps) {}

	getPublicStatus(): PlannerAuthorizationPublicStatus {
		const configured = this.deps.getAuthorizationMode();
		const effective =
			configured === "manual_prepare" &&
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
			grantActive: this.grant != null && !grantExpired(this.grant, this.deps.now().getTime()),
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

	async syncFromConfig(): Promise<void> {
		return this.mutex.runExclusive(async () => {
			const mode = this.deps.getAuthorizationMode();
			const effective =
				mode === "manual_prepare" &&
				this.deps.getRuntimeMode() === "shadow_auto" &&
				this.deps.getEvaluationMode() === "observe";
			if (!effective) {
				this.clearChallengeAndGrant("authorization_disabled");
				this.setState("disabled");
				await this.auditEvent("authorization_disabled", "ok");
			} else if (this.state === "disabled") {
				this.setState("idle");
				await this.auditEvent("authorization_enabled", "ok");
			}
			this.emitStatus();
		});
	}

	async prepare(): Promise<{ ok: boolean; code: string }> {
		return this.mutex.runExclusive(async () => {
			if (this.shuttingDown) return this.reject("prepare_rejected", "shutdown");
			await this.auditEvent("prepare_requested", "requested");
			const mode = this.deps.getAuthorizationMode();
			if (mode !== "manual_prepare") return this.reject("prepare_rejected", "authorization_disabled");
			if (this.challenge && !challengeExpired(this.challenge, this.nowMs()) && !this.challenge.consumed) {
				return this.reject("prepare_rejected", "challenge_active");
			}
			if (this.grant && !grantExpired(this.grant, this.nowMs())) {
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
			const challenge = createTakeoverChallenge({
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

	async confirm(challengeId: string): Promise<{ ok: boolean; code: string }> {
		return this.mutex.runExclusive(async () => {
			if (this.shuttingDown) return this.reject("confirm_rejected", "shutdown");
			await this.auditEvent("confirm_requested", "requested", challengeId, null);
			const challenge = this.challenge;
			if (!challenge) return this.reject("confirm_rejected", "challenge_active");
			if (challenge.consumed || this.replay.has(challenge.challengeId, this.nowMs())) {
				return this.reject("confirm_rejected", "challenge_active");
			}
			if (challengeExpired(challenge, this.nowMs())) {
				this.clearChallengeAndGrant("expired");
				this.setState("expired");
				await this.auditEvent("challenge_expired", "expired", challenge.challengeId, null);
				this.emitStatus();
				return { ok: false, code: "challenge_expired" };
			}
			if (challenge.challengeId !== challengeId) {
				challenge.confirmFailures += 1;
				if (challenge.confirmFailures >= TAKEOVER_MAX_CONFIRM_FAILURES) {
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
			this.replay.remember(challenge.challengeId, Date.parse(challenge.expiresAt) + TAKEOVER_AUTHORIZATION_GRANT_TTL_MS);
			const grant = mintAuthorizationGrantFromChallenge(challenge, this.nowMs(), this.deps.idFactory);
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

	async cancel(): Promise<{ ok: boolean; code: string }> {
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

	async invalidate(reason: string): Promise<void> {
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

	previewPermitMint(): CanonicalPermitMintPreview {
		const evidence = this.deps.getEvidence();
		return evaluateCanonicalPermitMintPreview({
			authorizationState: this.state,
			grant: this.grant,
			nowMs: this.nowMs(),
			evidenceReady: evidence?.state === "ready",
			revisionMatch: this.revisionsMatchActive(),
			executionModeDryrun: (this.deps.getEligibilityExtras() as { executionMode?: string }).executionMode !== "live",
			releaseGateClosed: true,
		});
	}

	async shutdown(): Promise<void> {
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

	private computeEligibility() {
		const extras = this.deps.getEligibilityExtras();
		const evidence = this.deps.getEvidence();
		const input: AuthorizationEligibilityInput = {
			nowMs: this.nowMs(),
			adapterReady: extras.adapterReady !== false,
			shuttingDown: this.shuttingDown || extras.shuttingDown === true,
			restoreBarrierActive: extras.restoreBarrierActive === true,
			operationLockActive: extras.operationLockActive === true,
			plannerRuntimeMode: this.deps.getRuntimeMode(),
			evaluationMode: this.deps.getEvaluationMode(),
			authorizationMode: this.deps.getAuthorizationMode(),
			evidence,
			expectedEvidenceSchemaVersion: TAKEOVER_EVIDENCE_SCHEMA_VERSION,
			expectedPolicyFingerprint: policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY),
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
			executionMode: (extras as { executionMode?: string }).executionMode ?? "dryrun",
			challengeActive: this.challenge != null && !this.challenge.consumed && !challengeExpired(this.challenge, this.nowMs()),
			grantActive: this.grant != null && !grantExpired(this.grant, this.nowMs()),
			releaseGateClosed: true,
		};
		return evaluateAuthorizationEligibility(input);
	}

	private computeEligibilityForConfirm(challenge: PlannerTakeoverChallenge) {
		// Confirm must not see challenge_active / grant_active as blockers for the challenge being confirmed.
		const extras = this.deps.getEligibilityExtras();
		const evidence = this.deps.getEvidence();
		return evaluateAuthorizationEligibility({
			nowMs: this.nowMs(),
			adapterReady: extras.adapterReady !== false,
			shuttingDown: this.shuttingDown || extras.shuttingDown === true,
			restoreBarrierActive: extras.restoreBarrierActive === true,
			operationLockActive: extras.operationLockActive === true,
			plannerRuntimeMode: this.deps.getRuntimeMode(),
			evaluationMode: this.deps.getEvaluationMode(),
			authorizationMode: this.deps.getAuthorizationMode(),
			evidence,
			expectedEvidenceSchemaVersion: TAKEOVER_EVIDENCE_SCHEMA_VERSION,
			expectedPolicyFingerprint: policyFingerprint(DEFAULT_TAKEOVER_READINESS_POLICY),
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
			executionMode: (extras as { executionMode?: string }).executionMode ?? "dryrun",
			challengeActive: false,
			grantActive: false,
			releaseGateClosed: true,
		});
	}

	private revisionsMatchChallenge(challenge: PlannerTakeoverChallenge): boolean {
		const bound = this.deps.getEligibilityExtras().bound;
		if (!bound) return false;
		return (
			bound.generation === challenge.generation &&
			bound.inputRevision === challenge.inputRevision &&
			bound.candidateRevision === challenge.candidateRevision &&
			bound.authoritativeRevision === challenge.authoritativeRevision &&
			bound.evidenceRevision === challenge.evidenceRevision &&
			bound.evidencePolicyRevision === challenge.evidencePolicyRevision &&
			bound.planningHorizonStart === challenge.planningHorizonStart &&
			bound.planningHorizonEnd === challenge.planningHorizonEnd &&
			bound.slotDurationMinutes === challenge.slotDurationMinutes &&
			bound.publishPolicyRevision === challenge.publishPolicyRevision
		);
	}

	private revisionsMatchActive(): boolean {
		if (this.grant) {
			const bound = this.deps.getEligibilityExtras().bound;
			if (!bound) return false;
			return (
				bound.generation === this.grant.generation &&
				bound.inputRevision === this.grant.inputRevision &&
				bound.candidateRevision === this.grant.candidateRevision &&
				bound.authoritativeRevision === this.grant.authoritativeRevision
			);
		}
		if (this.challenge) return this.revisionsMatchChallenge(this.challenge);
		return true;
	}

	private setState(to: PlannerAuthorizationState): void {
		const result = tryTransitionAuthorizationState(this.state, to);
		if (result.ok) this.state = result.state;
	}

	private clearChallengeAndGrant(_reason: string): void {
		this.clearChallengeTimer();
		this.clearGrantTimer();
		this.challenge = null;
		this.grant = null;
	}

	private armChallengeTimer(challenge: PlannerTakeoverChallenge): void {
		this.clearChallengeTimer();
		const delay = Math.max(0, Date.parse(challenge.expiresAt) - this.nowMs());
		this.challengeTimer = setTimeout(() => {
			void this.mutex.runExclusive(async () => {
				if (this.challenge?.challengeId !== challenge.challengeId) return;
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

	private armGrantTimer(grant: PlannerTakeoverAuthorizationGrant): void {
		this.clearGrantTimer();
		const delay = Math.max(0, Date.parse(grant.expiresAt) - this.nowMs());
		this.grantTimer = setTimeout(() => {
			void this.mutex.runExclusive(async () => {
				if (this.grant?.grantId !== grant.grantId) return;
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

	private clearChallengeTimer(): void {
		if (this.challengeTimer) clearTimeout(this.challengeTimer);
		this.challengeTimer = null;
	}

	private clearGrantTimer(): void {
		if (this.grantTimer) clearTimeout(this.grantTimer);
		this.grantTimer = null;
	}

	private nowMs(): number {
		return this.deps.now().getTime();
	}

	private async reject(event: string, code: string): Promise<{ ok: boolean; code: string }> {
		this.lastErrorCode = code;
		await this.auditEvent(event, code);
		this.emitStatus();
		return { ok: false, code };
	}

	private async auditEvent(
		eventCode: string,
		resultCode: string,
		challengeId?: string | null,
		grantId?: string | null,
	): Promise<void> {
		this.lastEventCode = eventCode;
		if (!this.deps.auditDir) return;
		try {
			if (!this.auditLoaded) {
				this.audit = await readAuthorizationAuditFile(this.deps.auditDir);
				this.auditLoaded = true;
			}
			const extras = this.deps.getEligibilityExtras();
			this.audit = appendAuditEntry(this.audit, {
				timestamp: this.deps.now().toISOString(),
				eventCode,
				resultCode,
				challengeIdShort: shortenId(challengeId),
				grantIdShort: shortenId(grantId),
				generation: extras.bound?.generation ?? null,
				inputRevisionShort: shortenId(extras.inputRevision, 12),
				candidateRevisionShort: shortenId(extras.candidateRevision, 12),
				authoritativeRevisionShort: shortenId(extras.authoritativeRevision, 12),
				evidenceRevisionShort: shortenId(this.deps.getEvidence()?.evidenceRevision, 12),
				sessionIdShort: shortenId(this.deps.sessionId, 8) ?? "unknown",
			});
			await writeAuthorizationAuditAtomic(this.deps.auditDir, this.audit);
		} catch {
			// audit failures isolated
		}
	}

	private emitStatus(): void {
		this.deps.onStatus?.(this.getPublicStatus());
	}
}
