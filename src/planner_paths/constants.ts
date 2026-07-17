/** Canonical durable plan filenames (single source of truth). */
export const CANONICAL_FORECAST_PLAN_FILE = "forecast_plan_v1.json";
export const CANONICAL_DAILY_PLAN_FILE = "daily_plan_v1.json";

/** Ephemeral job artifact filenames under runtime planner/jobs/<jobId>/. */
export const JOB_REQUEST_FILE = "request.json";
export const JOB_INPUT_FILE = "input.json";
export const JOB_SUMMARY_FILE = "summary.json";
export const JOB_RESULT_FILE = "result.json";

/** Relative segments under durable/runtime planner roots. */
export const DURABLE_PLANNER_SEGMENT = "planner";
export const RUNTIME_PLANNER_SEGMENT = "planner";
export const RUNTIME_JOBS_SEGMENT = "jobs";
export const RUNTIME_SIMULATIONS_SEGMENT = "simulations";
/** Non-canonical shadow candidates — never consumed by device runtimes. */
export const RUNTIME_CANDIDATE_SEGMENT = "candidate";
export const CANDIDATE_CURRENT_FILE = "plan_candidate_v1.json";
/** Takeover evaluation evidence — runtime only, never canonical. */
export const RUNTIME_TAKEOVER_SEGMENT = "takeover";
export const TAKEOVER_EVIDENCE_FILE_NAME = "evidence_v1.json";

/** Phase 3H worker-dryrun authority artifacts — runtime only, never durable. */
export const RUNTIME_WORKER_SEGMENT = "worker";
export const RUNTIME_WORKER_CANONICAL_SEGMENT = "canonical";
export const ACTIVE_AUTHORITY_POINTER_FILE = "active_authority_v1.json";
export const WORKER_PLAN_FILE = "plan_v1.json";
/** Alias kept for readability in docs/call sites. */
export const WORKER_CANONICAL_PLAN_FILE = WORKER_PLAN_FILE;
