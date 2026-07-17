/** Named constants for Phase 3H worker-dryrun authority. */

/** Dryrun pilot readiness thresholds — far lower than full takeover, dryrun only. */
export const DRYRUN_PILOT_MIN_ELIGIBLE_RUNS = 8;
export const DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES = 8;
export const DRYRUN_PILOT_MIN_OBSERVATION_MS = 30 * 60 * 1000;
export const DRYRUN_PILOT_MIN_SLOT_TRANSITIONS = 1;
export const DRYRUN_PILOT_MAX_MISMATCHES = 0;
export const DRYRUN_PILOT_MAX_FAILURES = 0;
export const DRYRUN_PILOT_MAX_LAST_RUN_AGE_MS = 20 * 60 * 1000;

/** Authority lease lifetime — long-lived within a session, never persisted. */
export const WORKER_DRYRUN_AUTHORITY_LEASE_TTL_MS = 24 * 60 * 60 * 1000;

/** A worker plan must cover at least this much future time to be authoritative. */
export const WORKER_PLAN_MIN_FUTURE_COVERAGE_MS = 30 * 60 * 1000;

/** Grace period before a worker plan is considered stale. */
export const WORKER_PLAN_STALE_GRACE_MS = 5 * 60 * 1000;

export const ACTIVE_AUTHORITY_SCHEMA_VERSION = 1 as const;
