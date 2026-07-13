/** Maximum bytes for planner input.json on disk. */
export const PLANNER_INPUT_SNAPSHOT_BUDGET_BYTES = 200 * 1024;

export const PLANNER_INPUT_SCHEMA_VERSION = 2;

/** Fields excluded from semantic inputRevision hashing. */
export const INPUT_REVISION_EXCLUDED_KEYS = ["capturedAt", "inputRevision", "sourceRevision"] as const;
