"use strict";
/** Conservative readiness policy — not admin-configurable in Phase 3F. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_TAKEOVER_READINESS_POLICY = exports.TAKEOVER_TOLERANCE_PERCENT = exports.TAKEOVER_TOLERANCE_PRICE_CT = exports.TAKEOVER_TOLERANCE_ENERGY_KWH = exports.TAKEOVER_TOLERANCE_POWER_W = exports.TAKEOVER_RUNTIME_SEGMENT = exports.TAKEOVER_EVIDENCE_FILE = exports.TAKEOVER_RETENTION_MAX_TOTAL_BYTES = exports.TAKEOVER_RETENTION_MAX_AGE_MS = exports.TAKEOVER_RETENTION_MAX_RECENT = exports.TAKEOVER_EVIDENCE_BUDGET_BYTES = exports.TAKEOVER_MAX_STALE_ELIGIBLE_MS = exports.TAKEOVER_MAX_FAILURES = exports.TAKEOVER_MAX_MISMATCHES = exports.TAKEOVER_MIN_DISTINCT_UTC_DAYS = exports.TAKEOVER_MIN_OBSERVATION_MS = exports.TAKEOVER_MIN_CONSECUTIVE_MATCHES = exports.TAKEOVER_MIN_ELIGIBLE_RUNS = exports.TAKEOVER_EVIDENCE_SCHEMA_VERSION = void 0;
exports.TAKEOVER_EVIDENCE_SCHEMA_VERSION = 1;
/** Minimum eligible dual runs before ready. */
exports.TAKEOVER_MIN_ELIGIBLE_RUNS = 96;
/** Minimum consecutive matches in the current series. */
exports.TAKEOVER_MIN_CONSECUTIVE_MATCHES = 96;
/** Minimum wall-clock observation window. */
exports.TAKEOVER_MIN_OBSERVATION_MS = 24 * 60 * 60 * 1000;
/** Minimum distinct UTC calendar days observed. */
exports.TAKEOVER_MIN_DISTINCT_UTC_DAYS = 2;
/** Any mismatch in the current observation window blocks ready. */
exports.TAKEOVER_MAX_MISMATCHES = 0;
/** Any failure in the current observation window blocks ready. */
exports.TAKEOVER_MAX_FAILURES = 0;
/** Last eligible run must be fresher than this. */
exports.TAKEOVER_MAX_STALE_ELIGIBLE_MS = 2 * 60 * 60 * 1000;
/** Evidence file budget. */
exports.TAKEOVER_EVIDENCE_BUDGET_BYTES = 16 * 1024;
/** Candidate retention. */
exports.TAKEOVER_RETENTION_MAX_RECENT = 8;
exports.TAKEOVER_RETENTION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
exports.TAKEOVER_RETENTION_MAX_TOTAL_BYTES = 8 * 1024 * 1024;
exports.TAKEOVER_EVIDENCE_FILE = "evidence_v1.json";
exports.TAKEOVER_RUNTIME_SEGMENT = "takeover";
/** Domain-specific numeric tolerances (absolute). */
exports.TAKEOVER_TOLERANCE_POWER_W = 0;
exports.TAKEOVER_TOLERANCE_ENERGY_KWH = 0.000_001;
exports.TAKEOVER_TOLERANCE_PRICE_CT = 0.000_1;
exports.TAKEOVER_TOLERANCE_PERCENT = 0.01;
exports.DEFAULT_TAKEOVER_READINESS_POLICY = {
    minEligibleRuns: exports.TAKEOVER_MIN_ELIGIBLE_RUNS,
    minConsecutiveMatches: exports.TAKEOVER_MIN_CONSECUTIVE_MATCHES,
    minObservationMs: exports.TAKEOVER_MIN_OBSERVATION_MS,
    minDistinctUtcDays: exports.TAKEOVER_MIN_DISTINCT_UTC_DAYS,
    maxMismatches: exports.TAKEOVER_MAX_MISMATCHES,
    maxFailures: exports.TAKEOVER_MAX_FAILURES,
    maxStaleEligibleMs: exports.TAKEOVER_MAX_STALE_ELIGIBLE_MS,
    requireSlotTransition: true,
    requireDayTransition: true,
};
