/** Policy Engine Foundation — Phase 3A */

export const POLICY_SCHEMA_VERSION = "policy_v1";
export const POLICY_ENGINE_VERSION = "0.1.56";

/** Learning darf erst ab dieser Confidence ein hartes technisches Limit setzen. */
export const LEARNING_HARD_LIMIT_MIN_CONFIDENCE = 0.6;

export const CONFIDENCE_MIN = 0;
export const CONFIDENCE_MAX = 1;

export const POLICY_ISSUE_SEVERITY_ORDER = ["error", "warning", "info"] as const;
