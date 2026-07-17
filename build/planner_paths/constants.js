"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_CANONICAL_PLAN_FILE = exports.WORKER_PLAN_FILE = exports.ACTIVE_AUTHORITY_POINTER_FILE = exports.RUNTIME_WORKER_CANONICAL_SEGMENT = exports.RUNTIME_WORKER_SEGMENT = exports.TAKEOVER_EVIDENCE_FILE_NAME = exports.RUNTIME_TAKEOVER_SEGMENT = exports.CANDIDATE_CURRENT_FILE = exports.RUNTIME_CANDIDATE_SEGMENT = exports.RUNTIME_SIMULATIONS_SEGMENT = exports.RUNTIME_JOBS_SEGMENT = exports.RUNTIME_PLANNER_SEGMENT = exports.DURABLE_PLANNER_SEGMENT = exports.JOB_RESULT_FILE = exports.JOB_SUMMARY_FILE = exports.JOB_INPUT_FILE = exports.JOB_REQUEST_FILE = exports.CANONICAL_DAILY_PLAN_FILE = exports.CANONICAL_FORECAST_PLAN_FILE = void 0;
/** Canonical durable plan filenames (single source of truth). */
exports.CANONICAL_FORECAST_PLAN_FILE = "forecast_plan_v1.json";
exports.CANONICAL_DAILY_PLAN_FILE = "daily_plan_v1.json";
/** Ephemeral job artifact filenames under runtime planner/jobs/<jobId>/. */
exports.JOB_REQUEST_FILE = "request.json";
exports.JOB_INPUT_FILE = "input.json";
exports.JOB_SUMMARY_FILE = "summary.json";
exports.JOB_RESULT_FILE = "result.json";
/** Relative segments under durable/runtime planner roots. */
exports.DURABLE_PLANNER_SEGMENT = "planner";
exports.RUNTIME_PLANNER_SEGMENT = "planner";
exports.RUNTIME_JOBS_SEGMENT = "jobs";
exports.RUNTIME_SIMULATIONS_SEGMENT = "simulations";
/** Non-canonical shadow candidates — never consumed by device runtimes. */
exports.RUNTIME_CANDIDATE_SEGMENT = "candidate";
exports.CANDIDATE_CURRENT_FILE = "plan_candidate_v1.json";
/** Takeover evaluation evidence — runtime only, never canonical. */
exports.RUNTIME_TAKEOVER_SEGMENT = "takeover";
exports.TAKEOVER_EVIDENCE_FILE_NAME = "evidence_v1.json";
/** Phase 3H worker-dryrun authority artifacts — runtime only, never durable. */
exports.RUNTIME_WORKER_SEGMENT = "worker";
exports.RUNTIME_WORKER_CANONICAL_SEGMENT = "canonical";
exports.ACTIVE_AUTHORITY_POINTER_FILE = "active_authority_v1.json";
exports.WORKER_PLAN_FILE = "plan_v1.json";
/** Alias kept for readability in docs/call sites. */
exports.WORKER_CANONICAL_PLAN_FILE = exports.WORKER_PLAN_FILE;
