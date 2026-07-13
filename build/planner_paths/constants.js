"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RUNTIME_SIMULATIONS_SEGMENT = exports.RUNTIME_JOBS_SEGMENT = exports.RUNTIME_PLANNER_SEGMENT = exports.DURABLE_PLANNER_SEGMENT = exports.JOB_RESULT_FILE = exports.JOB_SUMMARY_FILE = exports.JOB_INPUT_FILE = exports.JOB_REQUEST_FILE = exports.CANONICAL_DAILY_PLAN_FILE = exports.CANONICAL_FORECAST_PLAN_FILE = void 0;
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
