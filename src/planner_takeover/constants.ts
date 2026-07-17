/** Conservative readiness policy — not admin-configurable in Phase 3F. */

export const TAKEOVER_EVIDENCE_SCHEMA_VERSION = 1 as const;

/** Minimum eligible dual runs before ready. */
export const TAKEOVER_MIN_ELIGIBLE_RUNS = 96;

/** Minimum consecutive matches in the current series. */
export const TAKEOVER_MIN_CONSECUTIVE_MATCHES = 96;

/** Minimum wall-clock observation window. */
export const TAKEOVER_MIN_OBSERVATION_MS = 24 * 60 * 60 * 1000;

/** Minimum distinct UTC calendar days observed. */
export const TAKEOVER_MIN_DISTINCT_UTC_DAYS = 2;

/** Any mismatch in the current observation window blocks ready. */
export const TAKEOVER_MAX_MISMATCHES = 0;

/** Any failure in the current observation window blocks ready. */
export const TAKEOVER_MAX_FAILURES = 0;

/** Last eligible run must be fresher than this. */
export const TAKEOVER_MAX_STALE_ELIGIBLE_MS = 2 * 60 * 60 * 1000;

/** Evidence file budget. */
export const TAKEOVER_EVIDENCE_BUDGET_BYTES = 16 * 1024;

/** Candidate retention. */
export const TAKEOVER_RETENTION_MAX_RECENT = 8;
export const TAKEOVER_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
export const TAKEOVER_RETENTION_MAX_TOTAL_BYTES = 8 * 1024 * 1024;

export const TAKEOVER_EVIDENCE_FILE = "evidence_v1.json";
export const TAKEOVER_RUNTIME_SEGMENT = "takeover";

/** Domain-specific numeric tolerances (absolute). */
export const TAKEOVER_TOLERANCE_POWER_W = 0;
export const TAKEOVER_TOLERANCE_ENERGY_KWH = 0.000_001;
export const TAKEOVER_TOLERANCE_PRICE_CT = 0.000_1;
export const TAKEOVER_TOLERANCE_PERCENT = 0.01;

export interface TakeoverReadinessPolicy {
	minEligibleRuns: number;
	minConsecutiveMatches: number;
	minObservationMs: number;
	minDistinctUtcDays: number;
	maxMismatches: number;
	maxFailures: number;
	maxStaleEligibleMs: number;
	requireSlotTransition: boolean;
	requireDayTransition: boolean;
}

export const DEFAULT_TAKEOVER_READINESS_POLICY: TakeoverReadinessPolicy = {
	minEligibleRuns: TAKEOVER_MIN_ELIGIBLE_RUNS,
	minConsecutiveMatches: TAKEOVER_MIN_CONSECUTIVE_MATCHES,
	minObservationMs: TAKEOVER_MIN_OBSERVATION_MS,
	minDistinctUtcDays: TAKEOVER_MIN_DISTINCT_UTC_DAYS,
	maxMismatches: TAKEOVER_MAX_MISMATCHES,
	maxFailures: TAKEOVER_MAX_FAILURES,
	maxStaleEligibleMs: TAKEOVER_MAX_STALE_ELIGIBLE_MS,
	requireSlotTransition: true,
	requireDayTransition: true,
};
