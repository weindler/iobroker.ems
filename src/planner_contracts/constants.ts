/** Maximum bytes for IPC status payloads (stdout/stderr/summary/result transport). */
export const PLANNER_IPC_BUDGET_BYTES = 32 * 1024;

export const PLANNER_SCHEMA_VERSION = 1;

export const PLANNER_JOB_TRIGGERS = [
	"startup_missing_plan",
	"scheduled",
	"state_change",
	"manual",
	"ai",
	"intent",
] as const;

export const PLANNER_JOB_MODES = ["publish", "simulation", "explain"] as const;

export const PLANNER_JOB_KINDS = ["planner_snapshot_v2", "legacy_stub"] as const;

export const PLANNER_WORKER_STATUSES = ["ok", "error", "timeout", "stale"] as const;

export const PLANNER_CANONICAL_FORECAST_FILE = "forecast_plan_v1.json";
export const PLANNER_CANONICAL_DAILY_FILE = "daily_plan_v1.json";
