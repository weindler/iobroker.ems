"use strict";
/** Named constants for Phase 3H worker-dryrun authority. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ACTIVE_AUTHORITY_SCHEMA_VERSION = exports.WORKER_PLAN_STALE_GRACE_MS = exports.WORKER_PLAN_MIN_FUTURE_COVERAGE_MS = exports.WORKER_DRYRUN_AUTHORITY_LEASE_TTL_MS = exports.DRYRUN_PILOT_MAX_LAST_RUN_AGE_MS = exports.DRYRUN_PILOT_MAX_FAILURES = exports.DRYRUN_PILOT_MAX_MISMATCHES = exports.DRYRUN_PILOT_MIN_SLOT_TRANSITIONS = exports.DRYRUN_PILOT_MIN_OBSERVATION_MS = exports.DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES = exports.DRYRUN_PILOT_MIN_ELIGIBLE_RUNS = void 0;
/** Dryrun pilot readiness thresholds — far lower than full takeover, dryrun only. */
exports.DRYRUN_PILOT_MIN_ELIGIBLE_RUNS = 8;
exports.DRYRUN_PILOT_MIN_CONSECUTIVE_MATCHES = 8;
exports.DRYRUN_PILOT_MIN_OBSERVATION_MS = 30 * 60 * 1000;
exports.DRYRUN_PILOT_MIN_SLOT_TRANSITIONS = 1;
exports.DRYRUN_PILOT_MAX_MISMATCHES = 0;
exports.DRYRUN_PILOT_MAX_FAILURES = 0;
exports.DRYRUN_PILOT_MAX_LAST_RUN_AGE_MS = 20 * 60 * 1000;
/** Authority lease lifetime — long-lived within a session, never persisted. */
exports.WORKER_DRYRUN_AUTHORITY_LEASE_TTL_MS = 24 * 60 * 60 * 1000;
/** A worker plan must cover at least this much future time to be authoritative. */
exports.WORKER_PLAN_MIN_FUTURE_COVERAGE_MS = 30 * 60 * 1000;
/** Grace period before a worker plan is considered stale. */
exports.WORKER_PLAN_STALE_GRACE_MS = 5 * 60 * 1000;
exports.ACTIVE_AUTHORITY_SCHEMA_VERSION = 1;
