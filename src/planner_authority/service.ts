/**
 * Planner worker-dryrun authority service — Phase 3H.
 * Owns the worker-dryrun lease, publish permits, the active authority pointer and
 * the deterministic legacy fallback. Never enables live execution.
 */

import type { PlannerRequestedAuthority } from "../planner_config/authoritative_source";
import type { PlannerRuntimeMode } from "../planner_config";
import type { PlannerTakeoverEvaluationMode } from "../planner_config/evaluation_mode";
import type { PlannerTakeoverEvidence } from "../planner_takeover/types";
import type { PlannerPathLayout } from "../planner_paths/paths";
import type { PlannerPlanCandidate } from "../planner_candidate/types";
import type { PlannerTakeoverAuthorizationGrant } from "../planner_authorization/grant";
import { mintWorkerDryrunActivationCapabilityFromGrant } from "../planner_authorization/activation";
import {
	mintWorkerDryrunCanonicalPublishPermit,
	consumePermit,
	type CanonicalPublishPermit,
} from "../planner_publish/permit";
import { AuthorityMutex } from "./mutex";
import { mintWorkerDryrunAuthorityLease, isWorkerDryrunAuthorityLease, leaseExpired } from "./lease";
import { evaluateDryrunPilotReadiness } from "./pilot_readiness";
import { performLegacyFallback } from "./fallback";
import { publishWorkerCanonicalFromCandidate, WorkerPublishError } from "./publish";
import { writeWorkerPointer, writeLegacyPointer } from "./pointer";
import { getActiveAuthoritativePlannerView } from "./view";
import type {
	AuthoritativePlannerView,
	PlannerAuthorityPublicStatus,
	PlannerDryrunPilotReadiness,
	PlannerEffectiveAuthority,
	WorkerDryrunAuthorityLease,
} from "./types";

export interface AuthorityBoundRevisions {
	generation: number;
	inputRevision: string;
	candidateRevision: string;
	authoritativeRevision: string;
	evidenceRevision: string;
	evidencePolicyRevision: string;
}

export interface AuthorityServiceDeps {
	now: () => Date;
	adapterInstance: string;
	sessionId: string;
	layout: PlannerPathLayout;
	getConfiguredSource: () => PlannerRequestedAuthority;
	getRuntimeMode: () => PlannerRuntimeMode;
	getEvaluationMode: () => PlannerTakeoverEvaluationMode;
	getExecutionMode: () => string;
	getEvidence: () => PlannerTakeoverEvidence | null;
	getExpectedPolicyFingerprint: () => string;
	getBoundRevisions: () => AuthorityBoundRevisions | null;
	getCandidate: () => PlannerPlanCandidate | null;
	peekAuthorizationGrant: () => PlannerTakeoverAuthorizationGrant | null;
	consumeAuthorizationGrant: () => PlannerTakeoverAuthorizationGrant | null;
	requestLegacyRun: (reason: string) => void | Promise<void>;
	/** Optional host for projecting compact allocations into intent states. */
	getStateHost?: () => import("../ems_light/state_util").StateHost | null;
	onStatus?: (status: PlannerAuthorityPublicStatus) => void;
}

export class PlannerAuthorityService {
	private readonly mutex = new AuthorityMutex();
	private lease: WorkerDryrunAuthorityLease | null = null;
	private openPermit: CanonicalPublishPermit | null = null;
	private fallbackLatched = false;
	private fallbackReason: string | null = null;
	private workerCallbackActive = false;
	private shuttingDown = false;
	private lastEventCode: string | null = null;
	private lastErrorCode: string | null = null;
	private lastView: AuthoritativePlannerView | null = null;

	constructor(private readonly deps: AuthorityServiceDeps) {}

	private nowMs(): number {
		return this.deps.now().getTime();
	}

	private leaseActive(): boolean {
		return this.lease != null && !leaseExpired(this.lease, this.nowMs());
	}

	effectiveAuthority(): PlannerEffectiveAuthority {
		if (this.fallbackLatched) return "legacy_fallback";
		if (this.deps.getConfiguredSource() !== "worker_dryrun") return "legacy";
		if (this.leaseActive()) return "worker_dryrun";
		return "worker_pending";
	}

	isWorkerAuthoritative(): boolean {
		return this.effectiveAuthority() === "worker_dryrun";
	}

	shouldSkipLegacyAuthoritativeProjection(): boolean {
		return this.isWorkerAuthoritative();
	}

	shouldSkipRoutineDualRun(): boolean {
		return this.effectiveAuthority() === "worker_dryrun";
	}

	private pilotReadiness(): PlannerDryrunPilotReadiness {
		const bound = this.deps.getBoundRevisions();
		const evidence = this.deps.getEvidence();
		const identityMatches =
			bound != null && evidence != null
				? evidence.evidenceRevision === bound.evidenceRevision
				: false;
		return evaluateDryrunPilotReadiness({
			evaluationObserving: this.deps.getEvaluationMode() === "observe",
			evidence,
			nowMs: this.nowMs(),
			expectedPolicyFingerprint: this.deps.getExpectedPolicyFingerprint(),
			identityMatches,
		});
	}

	getPublicStatus(): PlannerAuthorityPublicStatus {
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

	async getView(refresh = true): Promise<AuthoritativePlannerView> {
		this.lastView = await getActiveAuthoritativePlannerView({
			layout: this.deps.layout,
			nowMs: this.nowMs(),
			refresh,
		});
		return this.lastView;
	}

	async activateWorkerDryrun(): Promise<{ ok: boolean; code: string }> {
		return this.mutex.runExclusive(async () => {
			if (this.shuttingDown) return this.fail("shutdown");
			if (this.deps.getConfiguredSource() !== "worker_dryrun") return this.fail("source_not_worker_dryrun");
			if (this.fallbackLatched) return this.fail("fallback_latched");
			if (this.deps.getRuntimeMode() !== "shadow_auto") return this.fail("runtime_mode_not_auto");
			if (this.deps.getEvaluationMode() !== "observe") return this.fail("evaluation_not_observe");
			if (this.deps.getExecutionMode() === "live") return this.fail("execution_mode_live");
			if (this.leaseActive()) return this.fail("already_active");

			const pilot = this.pilotReadiness();
			const evidence = this.deps.getEvidence();
			const fullReady = evidence?.state === "ready";
			// Inclusive OR — never XOR: full evidence ready OR dryrun pilot ready.
			const takeoverReady = fullReady || pilot.state === "ready";
			if (!takeoverReady) {
				return this.fail(pilot.primaryCode ?? "pilot_not_ready");
			}

			const bound = this.deps.getBoundRevisions();
			if (!bound) return this.fail("missing_bound_revisions");

			const grant = this.deps.peekAuthorizationGrant();
			if (!grant) return this.fail("no_grant");
			if (
				grant.generation !== bound.generation ||
				grant.inputRevision !== bound.inputRevision ||
				grant.candidateRevision !== bound.candidateRevision ||
				grant.authoritativeRevision !== bound.authoritativeRevision ||
				grant.evidenceRevision !== bound.evidenceRevision
			) {
				return this.fail("grant_revision_mismatch");
			}

			const candidate = this.deps.getCandidate();
			if (!candidate) return this.fail("no_candidate");
			if (candidate.candidateRevision !== bound.candidateRevision) return this.fail("candidate_revision_mismatch");

			const consumed = this.deps.consumeAuthorizationGrant();
			if (!consumed) return this.fail("grant_consume_failed");

			const nowMs = this.nowMs();
			const capability = mintWorkerDryrunActivationCapabilityFromGrant({
				grant: consumed,
				nowMs,
				generation: bound.generation,
				inputRevision: bound.inputRevision,
				candidateRevision: bound.candidateRevision,
				authoritativeRevision: bound.authoritativeRevision,
				evidenceRevision: bound.evidenceRevision,
			});
			if (!capability) return this.fail("capability_mint_failed");

			const lease = mintWorkerDryrunAuthorityLease({ capability, nowMs });
			if (!lease) return this.fail("lease_mint_failed");
			this.lease = lease;

			try {
				await this.publishCandidate(candidate, lease, nowMs);
			} catch (e) {
				const code = e instanceof WorkerPublishError ? e.code : "publish_failed";
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

	private async publishCandidate(
		candidate: PlannerPlanCandidate,
		lease: WorkerDryrunAuthorityLease,
		nowMs: number,
	): Promise<void> {
		if (!isWorkerDryrunAuthorityLease(lease) || leaseExpired(lease, nowMs)) {
			throw new WorkerPublishError("lease_invalid");
		}
		const permit = mintWorkerDryrunCanonicalPublishPermit({
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
		if (!permit) throw new WorkerPublishError("permit_mint_failed");
		this.openPermit = permit;
		const result = await publishWorkerCanonicalFromCandidate({
			candidate,
			generation: lease.generation,
			layout: this.deps.layout,
			permit,
			nowMs,
		});
		this.openPermit = null;
		await writeWorkerPointer(this.deps.layout, {
			generation: lease.generation,
			planPath: result.planPath,
			planRevision: result.planRevision,
			sessionId: this.deps.sessionId,
			nowMs,
		});
	}

	async deactivateWorker(): Promise<{ ok: boolean; code: string }> {
		return this.mutex.runExclusive(async () => {
			this.clearLeaseAndPermit();
			this.workerCallbackActive = false;
			this.fallbackReason = null;
			// Conscious revoke — no latch.
			await writeLegacyPointer(this.deps.layout, {
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

	async onWorkerJobSuccess(candidate: PlannerPlanCandidate, _jobId?: string): Promise<void> {
		return this.mutex.runExclusive(async () => {
			if (!this.workerCallbackActive || !this.leaseActive() || this.fallbackLatched) return;
			const lease = this.lease;
			if (!lease) return;
			const nowMs = this.nowMs();
			try {
				await this.publishCandidate(candidate, lease, nowMs);
				this.lastEventCode = "worker_job_published";
				await this.getView(true);
				await this.projectIntentIfPossible();
				this.emitStatus();
			} catch (e) {
				const code = e instanceof WorkerPublishError ? e.code : "publish_failed";
				await this.fallbackInternal(`worker_job_publish_failed:${code}`);
			}
		});
	}

	async fallback(reason: string): Promise<void> {
		return this.mutex.runExclusive(async () => {
			await this.fallbackInternal(reason);
		});
	}

	private async fallbackInternal(reason: string): Promise<void> {
		await performLegacyFallback(
			{
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
			},
			reason,
		);
		this.lastEventCode = "legacy_fallback";
		await this.getView(true).catch(() => undefined);
		this.emitStatus();
	}

	async onExecutionModeChange(mode: string): Promise<void> {
		if (mode !== "dryrun") {
			await this.fallback(mode === "live" ? "execution_mode_live" : "execution_mode_not_dryrun");
		}
	}

	async onConfiguredSourceChange(): Promise<void> {
		return this.mutex.runExclusive(async () => {
			if (this.deps.getConfiguredSource() !== "worker_dryrun") {
				this.clearLeaseAndPermit();
				this.workerCallbackActive = false;
				await writeLegacyPointer(this.deps.layout, {
					generation: this.deps.getBoundRevisions()?.generation ?? 0,
					sessionId: this.deps.sessionId,
					nowMs: this.nowMs(),
				}).catch(() => undefined);
			}
			this.emitStatus();
		});
	}

	async shutdown(): Promise<void> {
		return this.mutex.runExclusive(async () => {
			this.shuttingDown = true;
			this.clearLeaseAndPermit();
			this.workerCallbackActive = false;
			// Leave a clean legacy pointer — leases are never persisted.
			await writeLegacyPointer(this.deps.layout, {
				generation: this.deps.getBoundRevisions()?.generation ?? 0,
				sessionId: this.deps.sessionId,
				nowMs: this.nowMs(),
			}).catch(() => undefined);
			this.emitStatus();
		});
	}

	private async projectIntentIfPossible(): Promise<void> {
		const host = this.deps.getStateHost?.() ?? null;
		if (!host || !this.lastView) return;
		try {
			const { projectWorkerViewToIntentStates } = await import("./project_intent.js");
			await projectWorkerViewToIntentStates(host, {
				view: this.lastView,
				now: this.deps.now(),
				timezone: "Europe/Berlin",
				globalMode: "balanced",
				slotMinutes: 15,
			});
		} catch {
			// projection failures must not break authority
		}
	}

	private clearLeaseAndPermit(): void {
		if (this.openPermit) consumePermit(this.openPermit);
		this.openPermit = null;
		this.lease = null;
	}

	private fail(code: string): { ok: boolean; code: string } {
		this.lastErrorCode = code;
		this.lastEventCode = "activate_rejected";
		this.emitStatus();
		return { ok: false, code };
	}

	private emitStatus(): void {
		this.deps.onStatus?.(this.getPublicStatus());
	}
}
