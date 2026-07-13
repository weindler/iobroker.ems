"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PLANNER_CANONICAL_DAILY_FILE = exports.PLANNER_CANONICAL_FORECAST_FILE = exports.PLANNER_WORKER_STATUSES = exports.PLANNER_JOB_KINDS = exports.PLANNER_JOB_MODES = exports.PLANNER_JOB_TRIGGERS = exports.PLANNER_SCHEMA_VERSION = exports.PLANNER_IPC_BUDGET_BYTES = void 0;
/** Maximum bytes for IPC status payloads (stdout/stderr/summary/result transport). */
exports.PLANNER_IPC_BUDGET_BYTES = 32 * 1024;
exports.PLANNER_SCHEMA_VERSION = 1;
exports.PLANNER_JOB_TRIGGERS = [
    "startup_missing_plan",
    "scheduled",
    "state_change",
    "manual",
    "ai",
    "intent",
];
exports.PLANNER_JOB_MODES = ["publish", "simulation", "explain"];
exports.PLANNER_JOB_KINDS = ["planner_snapshot_v2", "legacy_stub"];
exports.PLANNER_WORKER_STATUSES = ["ok", "error", "timeout", "stale"];
exports.PLANNER_CANONICAL_FORECAST_FILE = "forecast_plan_v1.json";
exports.PLANNER_CANONICAL_DAILY_FILE = "daily_plan_v1.json";
