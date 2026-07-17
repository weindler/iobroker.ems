import * as fs from "node:fs";
import * as path from "node:path";
import { PLANNER_CANDIDATE_FILE, type PlannerPlanCandidate } from "../planner_candidate/types";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";
import type { PlannerTriggerRequest } from "../planner_coordinator/types";
import type { DualRunBridgeContext } from "./session";
import {
	authoritativeProjectionIsUsable,
	getActiveAuthoritativeProjection,
} from "./authoritative_projection";
import { resolvePlannerTakeoverDecision } from "./decision";
import { buildIdentityFromCandidates, recordDualRun } from "./record";
import { writePlannerTakeoverStates } from "./states";

/**
 * Dual-run evidence hook.
 * Authoritative candidate MUST come from the once-computed store — never rebuild via
 * buildPlanCandidateFromSnapshot here.
 */
export async function handleCoordinatorDualRunOutcome(
	ctx: DualRunBridgeContext,
	event: {
		result: "success" | "failed";
		trigger: PlannerTriggerRequest;
		generation: number;
		jobId?: string;
		snapshot: PlannerInputSnapshot;
		errorCode?: string;
		shuttingDown: boolean;
		authoritativeFailed?: boolean;
		authoritativeErrorCode?: string;
	},
): Promise<void> {
	const runtimeMode = ctx.getPlannerRuntimeMode();
	const evaluationMode = ctx.getConfiguredEvaluationMode();
	if (runtimeMode !== "shadow_auto" || evaluationMode !== "observe") {
		const host = ctx.getStateHost();
		if (host) {
			const { emptyTakeoverEvidence, sealEvidence } = await import("./evidence.js");
			const evidence = sealEvidence({
				...emptyTakeoverEvidence(),
				state: "not_evaluated",
				lastBlockReason: runtimeMode === "shadow_auto" ? "evaluation_disabled" : "runtime_mode_not_auto",
			});
			const decision = resolvePlannerTakeoverDecision({
				requestedTarget: "canonical",
				evaluationState: "not_evaluated",
				evidence,
			});
			await writePlannerTakeoverStates(host, {
				configuredMode: evaluationMode,
				effectiveMode: "disabled",
				evidence,
				decision,
			});
		}
		return;
	}

	const stored = getActiveAuthoritativeProjection();
	let authoritative: PlannerPlanCandidate | null = null;
	const generationMatches = stored != null && stored.generation === event.generation;
	const jobMatches = stored != null && (event.jobId == null || stored.jobId === event.jobId);
	let authFailed =
		event.authoritativeFailed === true ||
		!authoritativeProjectionIsUsable(stored) ||
		!generationMatches ||
		!jobMatches;

	if (!authFailed && authoritativeProjectionIsUsable(stored)) {
		// Reuse the exact object from the single authoritative computation — never rebuild.
		authoritative = stored.candidate;
	} else {
		authoritative = null;
		authFailed = true;
	}

	let worker: PlannerPlanCandidate | null = null;
	if (event.jobId) {
		try {
			const raw = fs.readFileSync(
				path.join(ctx.layout.candidateJobDir(event.jobId), PLANNER_CANDIDATE_FILE),
				"utf8",
			);
			worker = JSON.parse(raw) as PlannerPlanCandidate;
		} catch {
			try {
				const raw = fs.readFileSync(
					path.join(ctx.layout.jobDir(event.jobId), PLANNER_CANDIDATE_FILE),
					"utf8",
				);
				worker = JSON.parse(raw) as PlannerPlanCandidate;
			} catch {
				worker = null;
			}
		}
	}

	const force = event.trigger.force === true || event.trigger.reason === "manual";
	const identityBase = authoritative
		? buildIdentityFromCandidates({
				generation: event.generation,
				triggerClass: event.trigger.reason,
				triggerReason: event.trigger.reason,
				force,
				authoritative,
				snapshotSchemaVersion: event.snapshot.schemaVersion,
			})
		: {
				generation: event.generation,
				triggerClass: event.trigger.reason,
				triggerReason: event.trigger.reason,
				inputRevision: stored?.inputRevision ?? event.snapshot.inputRevision,
				snapshotSchemaVersion: event.snapshot.schemaVersion,
				planningHorizonStart: stored?.horizonStart ?? "",
				planningHorizonEnd: stored?.horizonEnd ?? "",
				slotDurationMinutes: stored?.slotDurationMinutes ?? 15,
				force,
				plannerContractVersion: 1 as const,
			};

	const recorded = await recordDualRun({
		nowIso: new Date().toISOString(),
		plannerRuntimeMode: runtimeMode,
		configuredEvaluationMode: evaluationMode,
		shuttingDown: event.shuttingDown || ctx.isShuttingDown(),
		identity: identityBase,
		authoritativeCandidate: authoritative,
		workerCandidate: worker,
		errorCode:
			event.authoritativeErrorCode ??
			stored?.publishErrorCode ??
			(authFailed ? "authoritative_failed" : event.errorCode),
		diagnosticOnly: force,
		jobId: event.jobId,
		takeoverDir: ctx.layout.runtimeTakeoverDir,
		candidateRootDir: ctx.layout.runtimeCandidateDir,
		protectedJobIds: ctx.getProtectedJobIds?.(),
	});

	const host = ctx.getStateHost();
	if (host) {
		const decision = resolvePlannerTakeoverDecision({
			requestedTarget: "canonical",
			evaluationState: recorded.evidence.state,
			evidence: recorded.evidence,
			inputRevision: identityBase.inputRevision,
			candidateRevision: recorded.evidence.lastCandidateRevision,
			authoritativeRevision: recorded.evidence.lastAuthoritativeRevision,
			shuttingDown: event.shuttingDown,
		});
		await writePlannerTakeoverStates(host, {
			configuredMode: evaluationMode,
			effectiveMode: "observe",
			evidence: recorded.evidence,
			decision,
		});
	}

	try {
		const { configureAuthorizationSession, getAuthorizationSession } = await import(
			"../planner_authorization/runtime_session.js"
		);
		const authRev = recorded.evidence.lastAuthoritativeRevision;
		const candRev = recorded.evidence.lastCandidateRevision;
		configureAuthorizationSession({
			evidence: recorded.evidence,
			lastCompareStatus: recorded.compare?.status ?? event.result,
			authoritativePublishOk: !authFailed && stored?.publishStatus === "ok",
			candidateValid: worker?.validationStatus === "ok" || worker?.validationStatus === "degraded",
			bound:
				authRev && candRev && identityBase.inputRevision
					? {
							generation: event.generation,
							inputRevision: identityBase.inputRevision,
							candidateRevision: candRev,
							authoritativeRevision: authRev,
							evidenceRevision: recorded.evidence.evidenceRevision,
							evidencePolicyRevision: recorded.evidence.policyFingerprint,
							planningHorizonStart: identityBase.planningHorizonStart,
							planningHorizonEnd: identityBase.planningHorizonEnd,
							slotDurationMinutes: identityBase.slotDurationMinutes,
							plannerContractVersion: identityBase.plannerContractVersion ?? 1,
							snapshotSchemaVersion: event.snapshot.schemaVersion,
							publishPolicyRevision: "phase_3g_closed",
						}
					: null,
		});
		const svc = getAuthorizationSession().service;
		if (svc && recorded.compare?.status && recorded.compare.status !== "matched") {
			await svc.invalidate(recorded.compare.status);
		}
	} catch {
		// authorization session optional
	}
}
