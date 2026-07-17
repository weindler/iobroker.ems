import type { PlannerPlanCandidate } from "../planner_candidate/types";
import type { PlannerRuntimeMode } from "../planner_config";
import type { PlannerTakeoverEvaluationMode } from "../planner_config/evaluation_mode";
import { compareNormalizedPlans } from "./compare";
import {
	DEFAULT_TAKEOVER_READINESS_POLICY,
	type TakeoverReadinessPolicy,
} from "./constants";
import { buildDualRunId, correlateDualRuns, resolveEffectiveTakeoverEvaluation } from "./correlation";
import { applyDualRunToEvidence, emptyTakeoverEvidence, sealEvidence } from "./evidence";
import { readTakeoverEvidenceFile, writeTakeoverEvidenceAtomic } from "./evidence_io";
import { projectCandidateToNormalizedPlan } from "./project";
import { retainPlannerCandidates } from "./retention";
import { slotDurationMinutes } from "./canonize";
import type {
	DualRunCompareResult,
	PlannerDualRunIdentity,
	PlannerTakeoverEvidence,
} from "./types";

export interface DualRunRecordInput {
	nowIso: string;
	plannerRuntimeMode: PlannerRuntimeMode;
	configuredEvaluationMode: PlannerTakeoverEvaluationMode;
	shuttingDown: boolean;
	identity: Omit<PlannerDualRunIdentity, "dualRunId">;
	authoritativeCandidate: PlannerPlanCandidate | null;
	workerCandidate: PlannerPlanCandidate | null;
	errorCode?: string | null;
	/** Force / manual diagnostic runs. */
	diagnosticOnly?: boolean;
	jobId?: string;
	takeoverDir: string;
	candidateRootDir: string;
	protectedJobIds?: readonly string[];
	policy?: TakeoverReadinessPolicy;
}

export interface DualRunRecordResult {
	evidence: PlannerTakeoverEvidence;
	compare: DualRunCompareResult | null;
	observing: boolean;
	eligibleConsidered: boolean;
}

/**
 * Evaluate one dual run and persist evidence when observing.
 * Authoritative publish is never invoked here.
 */
export async function recordDualRun(input: DualRunRecordInput): Promise<DualRunRecordResult> {
	const policy = input.policy ?? DEFAULT_TAKEOVER_READINESS_POLICY;
	const effective = resolveEffectiveTakeoverEvaluation({
		plannerRuntimeMode: input.plannerRuntimeMode,
		configuredEvaluationMode: input.configuredEvaluationMode,
	});

	if (!effective.observing) {
		const evidence = sealEvidence({
			...emptyTakeoverEvidence(policy),
			state: "not_evaluated",
			lastBlockReason: input.plannerRuntimeMode === "shadow_auto" ? "evaluation_disabled" : "runtime_mode_not_auto",
		});
		return { evidence, compare: null, observing: false, eligibleConsidered: false };
	}

	const identity: PlannerDualRunIdentity = {
		...input.identity,
		dualRunId: buildDualRunId(input.identity),
	};

	let compare: DualRunCompareResult;
	if (input.shuttingDown) {
		compare = { status: "aborted", mismatchCount: 0, mismatchedSlotCount: 0 };
	} else if (!input.authoritativeCandidate) {
		compare = { status: "authoritative_failed", mismatchCount: 0, mismatchedSlotCount: 0 };
	} else if (!input.workerCandidate) {
		compare = {
			status: "worker_failed",
			mismatchCount: 0,
			mismatchedSlotCount: 0,
			authoritativeRevision: projectCandidateToNormalizedPlan(input.authoritativeCandidate).semanticRevision,
		};
	} else {
		const authNorm = projectCandidateToNormalizedPlan(input.authoritativeCandidate);
		const workNorm = projectCandidateToNormalizedPlan(input.workerCandidate);
		const authIdentity: PlannerDualRunIdentity = {
			...identity,
			planningHorizonStart: authNorm.horizon.start,
			planningHorizonEnd: authNorm.horizon.end,
			slotDurationMinutes: authNorm.horizon.slotMinutes,
		};
		const workIdentity: PlannerDualRunIdentity = {
			...identity,
			planningHorizonStart: workNorm.horizon.start,
			planningHorizonEnd: workNorm.horizon.end,
			slotDurationMinutes: workNorm.horizon.slotMinutes,
			inputRevision: input.workerCandidate.inputRevision,
		};
		const correlation = correlateDualRuns({
			authoritative: {
				...authIdentity,
				inputRevision: input.authoritativeCandidate.inputRevision,
			},
			candidate: workIdentity,
		});
		if (correlation.status === "not_comparable") {
			compare = {
				status: "not_comparable",
				mismatchCount: 1,
				mismatchedSlotCount: 0,
				firstMismatchDomain: correlation.reason,
				firstMismatchPath: correlation.reason,
				authoritativeRevision: authNorm.semanticRevision,
				candidateRevision: workNorm.semanticRevision,
			};
		} else {
			compare = compareNormalizedPlans(authNorm, workNorm);
		}
	}

	const loaded = await readTakeoverEvidenceFile(input.takeoverDir, policy);
	const evidence = applyDualRunToEvidence(loaded.evidence, {
		nowIso: input.nowIso,
		observing: true,
		shuttingDown: input.shuttingDown,
		identity,
		compareStatus: compare.status,
		firstMismatchDomain: compare.firstMismatchDomain,
		authoritativeRevision: compare.authoritativeRevision,
		candidateRevision: compare.candidateRevision,
		errorCode: input.errorCode,
		policy,
		diagnosticOnly: input.diagnosticOnly === true || identity.force,
	});

	if (!input.shuttingDown) {
		await writeTakeoverEvidenceAtomic(input.takeoverDir, evidence).catch(() => undefined);
		const keep: string[] = [];
		if (input.jobId && (compare.status === "mismatch" || compare.status === "worker_failed")) {
			keep.push(input.jobId);
		}
		await retainPlannerCandidates({
			candidateRootDir: input.candidateRootDir,
			protectedJobIds: input.protectedJobIds,
			keepJobIds: keep,
		}).catch(() => undefined);
	}

	return {
		evidence,
		compare,
		observing: true,
		eligibleConsidered: !(input.diagnosticOnly === true || identity.force) && compare.status !== "aborted",
	};
}

export function buildIdentityFromCandidates(input: {
	generation: number;
	triggerClass: string;
	triggerReason: string;
	force: boolean;
	authoritative: PlannerPlanCandidate;
	snapshotSchemaVersion: number;
}): Omit<PlannerDualRunIdentity, "dualRunId"> {
	const slotMinutes =
		input.authoritative.forecastSlots[0]
			? slotDurationMinutes(
					input.authoritative.forecastSlots[0].start,
					input.authoritative.forecastSlots[0].end,
				)
			: 15;
	return {
		generation: input.generation,
		triggerClass: input.triggerClass,
		triggerReason: input.triggerReason,
		inputRevision: input.authoritative.inputRevision,
		snapshotSchemaVersion: input.snapshotSchemaVersion,
		planningHorizonStart: input.authoritative.horizonStart,
		planningHorizonEnd: input.authoritative.horizonEnd,
		slotDurationMinutes: slotMinutes,
		force: input.force,
		plannerContractVersion: 1,
	};
}
