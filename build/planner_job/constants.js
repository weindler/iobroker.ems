"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANNER_WORKER_STATUS_PREFIX = exports.PLANNER_WORKER_STDIO_BUDGET_BYTES = exports.PLANNER_MAX_FAILED_JOB_RETENTION = exports.PLANNER_SIGKILL_GRACE_MS = exports.PLANNER_DEFAULT_JOB_TIMEOUT_MS = void 0;
/** Default worker job timeout when request does not specify one. */
exports.PLANNER_DEFAULT_JOB_TIMEOUT_MS = 120_000;
/** Grace period after SIGTERM before SIGKILL. */
exports.PLANNER_SIGKILL_GRACE_MS = 5_000;
/** Failed job directories retained for diagnostics. */
exports.PLANNER_MAX_FAILED_JOB_RETENTION = 5;
/** Worker stdout/stderr combined capture limit (status only, no plans). */
exports.PLANNER_WORKER_STDIO_BUDGET_BYTES = 32 * 1024;
exports.PLANNER_WORKER_STATUS_PREFIX = "PLANNER_WORKER_STATUS:";
