/**
 * Authoritative dual-run projection — computed exactly once per dual run.
 * Compare / evidence paths MUST reuse this object and must not call
 * buildPlanCandidateFromSnapshot again for the authoritative side.
 */

import { buildPlanCandidateFromSnapshot } from "../planner_candidate/build";
import type { PlannerPlanCandidate } from "../planner_candidate/types";
import type { PlannerInputSnapshot } from "../planner_snapshot/types";

export type AuthoritativePublishStatus = "ok" | "failed" | "not_attempted";

export interface AuthoritativeDualRunProjection {
	generation: number;
	jobId: string;
	inputRevision: string;
	snapshotSchemaVersion: number;
	horizonStart: string;
	horizonEnd: string;
	slotDurationMinutes: number;
	/** Exact candidate object from the single authoritative computation. */
	candidate: PlannerPlanCandidate;
	/** Dual-run does not perform durable canonical publish; records seal outcome. */
	publishStatus: AuthoritativePublishStatus;
	publishErrorCode?: string;
	computedAt: string;
}

let active: AuthoritativeDualRunProjection | null = null;
/** Test / diagnostics: how often the authoritative pure core ran. */
let authoritativeComputeCount = 0;
/** Test: how often compare/evidence attempted a forbidden recomputation helper. */
let forbiddenRecomputeAttempts = 0;

export function getAuthoritativeComputeCountForTest(): number {
	return authoritativeComputeCount;
}

export function getForbiddenRecomputeAttemptsForTest(): number {
	return forbiddenRecomputeAttempts;
}

export function resetAuthoritativeProjectionCountersForTest(): void {
	authoritativeComputeCount = 0;
	forbiddenRecomputeAttempts = 0;
	active = null;
}

export function getActiveAuthoritativeProjection(): AuthoritativeDualRunProjection | null {
	return active;
}

export function clearActiveAuthoritativeProjection(): void {
	active = null;
}

/**
 * Single authoritative computation for a dual run.
 * Callers must not invoke buildPlanCandidateFromSnapshot again for the same run's reference side.
 */
export function computeAuthoritativeDualRunProjection(input: {
	snapshot: PlannerInputSnapshot;
	generation: number;
	jobId: string;
	nowIso?: string;
	/**
	 * Optional publish seal for the dual-run authoritative side.
	 * Must not write durable canonical plans. Returning false → publishStatus failed.
	 */
	sealPublish?: (candidate: PlannerPlanCandidate) => boolean;
}): AuthoritativeDualRunProjection {
	authoritativeComputeCount += 1;
	const built = buildPlanCandidateFromSnapshot(input.snapshot);
	const candidate = built.candidate;
	const first = candidate.forecastSlots[0];
	const slotDurationMinutes =
		first != null
			? Math.max(1, Math.round((Date.parse(first.end) - Date.parse(first.start)) / 60_000))
			: 15;

	let publishStatus: AuthoritativePublishStatus = "ok";
	let publishErrorCode: string | undefined;
	if (input.sealPublish) {
		try {
			const ok = input.sealPublish(candidate);
			if (!ok) {
				publishStatus = "failed";
				publishErrorCode = "authoritative_publish_failed";
			}
		} catch (e) {
			publishStatus = "failed";
			publishErrorCode = "authoritative_publish_failed";
			void e;
		}
	} else {
		publishStatus = "ok";
	}

	active = {
		generation: input.generation,
		jobId: input.jobId,
		inputRevision: input.snapshot.inputRevision,
		snapshotSchemaVersion: input.snapshot.schemaVersion,
		horizonStart: candidate.horizonStart,
		horizonEnd: candidate.horizonEnd,
		slotDurationMinutes,
		candidate,
		publishStatus,
		publishErrorCode,
		computedAt: input.nowIso ?? new Date().toISOString(),
	};
	return active;
}

/**
 * Explicitly mark that a dual-run path attempted to rebuild the authoritative
 * reference — forbidden. Increments diagnostic counter and returns null.
 */
export function forbidAuthoritativeRecompute(): null {
	forbiddenRecomputeAttempts += 1;
	return null;
}

export function authoritativeProjectionIsUsable(
	projection: AuthoritativeDualRunProjection | null,
): projection is AuthoritativeDualRunProjection {
	return (
		projection != null &&
		projection.publishStatus === "ok" &&
		projection.candidate != null
	);
}
