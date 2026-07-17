/** Named constants for Phase 3G authorization ceremony. */

export const TAKEOVER_CHALLENGE_TTL_MS = 10 * 60 * 1000;
export const TAKEOVER_AUTHORIZATION_GRANT_TTL_MS = 5 * 60 * 1000;
export const TAKEOVER_MAX_CONFIRM_FAILURES = 3;
export const TAKEOVER_REPLAY_CACHE_MAX_ENTRIES = 32;
export const TAKEOVER_AUTHORIZATION_AUDIT_MAX_ENTRIES = 64;
export const TAKEOVER_AUTHORIZATION_AUDIT_MAX_BYTES = 128 * 1024;
export const TAKEOVER_AUTHORIZATION_AUDIT_FILE = "authorization_audit_v1.json";
export const TAKEOVER_CHALLENGE_SCHEMA_VERSION = 1 as const;
export const TAKEOVER_AUTHORIZATION_AUDIT_SCHEMA_VERSION = 1 as const;
