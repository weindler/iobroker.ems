/** Default worker job timeout when request does not specify one. */
export const PLANNER_DEFAULT_JOB_TIMEOUT_MS = 120_000;

/** Grace period after SIGTERM before SIGKILL. */
export const PLANNER_SIGKILL_GRACE_MS = 5_000;

/** Failed job directories retained for diagnostics. */
export const PLANNER_MAX_FAILED_JOB_RETENTION = 5;

/** Worker stdout/stderr combined capture limit (status only, no plans). */
export const PLANNER_WORKER_STDIO_BUDGET_BYTES = 32 * 1024;

export const PLANNER_WORKER_STATUS_PREFIX = "PLANNER_WORKER_STATUS:";
