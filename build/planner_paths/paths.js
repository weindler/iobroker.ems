"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.assertJobPathNotUnderDurableDataFolder = exports.resolvePlannerPaths = void 0;
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
const constants_1 = require("./constants");
function assertSafeGeneration(generation) {
    if (!Number.isInteger(generation) || generation < 0 || generation > Number.MAX_SAFE_INTEGER) {
        throw new Error("invalid generation");
    }
    return String(generation);
}
function assertSafeJobId(jobId) {
    (0, paths_1.assertSafeRelativeSegment)(jobId);
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(jobId)) {
        throw new Error("invalid job id");
    }
}
/**
 * Central planner path layout. Job/simulation artifacts live exclusively under runtimeDataDir.
 */
function resolvePlannerPaths(input) {
    const ems = (0, paths_1.resolveEmsPaths)(input);
    const durablePlannerDir = path.join(ems.durableDataDir, constants_1.DURABLE_PLANNER_SEGMENT);
    const runtimePlannerDir = path.join(ems.runtimeDataDir, constants_1.RUNTIME_PLANNER_SEGMENT);
    const runtimeJobsDir = path.join(runtimePlannerDir, constants_1.RUNTIME_JOBS_SEGMENT);
    const runtimeSimulationsDir = path.join(runtimePlannerDir, constants_1.RUNTIME_SIMULATIONS_SEGMENT);
    const runtimeCandidateDir = path.join(runtimePlannerDir, constants_1.RUNTIME_CANDIDATE_SEGMENT);
    const runtimeTakeoverDir = path.join(runtimePlannerDir, constants_1.RUNTIME_TAKEOVER_SEGMENT);
    const workerCanonicalDir = path.join(runtimePlannerDir, constants_1.RUNTIME_WORKER_SEGMENT, constants_1.RUNTIME_WORKER_CANONICAL_SEGMENT);
    (0, paths_1.assertPathWithinRoot)(durablePlannerDir, ems.durableDataDir);
    (0, paths_1.assertPathWithinRoot)(runtimePlannerDir, ems.runtimeDataDir);
    (0, paths_1.assertPathWithinRoot)(runtimeJobsDir, ems.runtimeDataDir);
    (0, paths_1.assertPathWithinRoot)(runtimeSimulationsDir, ems.runtimeDataDir);
    (0, paths_1.assertPathWithinRoot)(runtimeCandidateDir, ems.runtimeDataDir);
    (0, paths_1.assertPathWithinRoot)(runtimeTakeoverDir, ems.runtimeDataDir);
    (0, paths_1.assertPathWithinRoot)(workerCanonicalDir, ems.runtimeDataDir);
    return {
        durablePlannerDir,
        canonicalForecastPlanPath: path.join(durablePlannerDir, constants_1.CANONICAL_FORECAST_PLAN_FILE),
        canonicalDailyPlanPath: path.join(durablePlannerDir, constants_1.CANONICAL_DAILY_PLAN_FILE),
        runtimePlannerDir,
        runtimeJobsDir,
        runtimeSimulationsDir,
        runtimeCandidateDir,
        runtimeTakeoverDir,
        takeoverEvidencePath: path.join(runtimeTakeoverDir, constants_1.TAKEOVER_EVIDENCE_FILE_NAME),
        activeAuthorityPointerPath: path.join(runtimePlannerDir, constants_1.ACTIVE_AUTHORITY_POINTER_FILE),
        workerCanonicalDir,
        workerCanonicalGenerationDir: (generation) => {
            const dir = path.join(workerCanonicalDir, assertSafeGeneration(generation));
            (0, paths_1.assertPathWithinRoot)(dir, ems.runtimeDataDir);
            return dir;
        },
        workerCanonicalPlanPath: (generation) => {
            const dir = path.join(workerCanonicalDir, assertSafeGeneration(generation));
            const file = path.join(dir, constants_1.WORKER_PLAN_FILE);
            (0, paths_1.assertPathWithinRoot)(file, ems.runtimeDataDir);
            return file;
        },
        jobDir: (jobId) => {
            assertSafeJobId(jobId);
            const dir = path.join(runtimeJobsDir, jobId);
            (0, paths_1.assertPathWithinRoot)(dir, ems.runtimeDataDir);
            return dir;
        },
        simulationDir: (jobId) => {
            assertSafeJobId(jobId);
            const dir = path.join(runtimeSimulationsDir, jobId);
            (0, paths_1.assertPathWithinRoot)(dir, ems.runtimeDataDir);
            return dir;
        },
        candidateJobDir: (jobId) => {
            assertSafeJobId(jobId);
            const dir = path.join(runtimeCandidateDir, jobId);
            (0, paths_1.assertPathWithinRoot)(dir, ems.runtimeDataDir);
            return dir;
        },
    };
}
exports.resolvePlannerPaths = resolvePlannerPaths;
/** Job artifacts must not live under the durable ioBroker dataFolder root. */
function assertJobPathNotUnderDurableDataFolder(jobPath, durableDataDir) {
    const resolvedJob = path.resolve(jobPath);
    const resolvedDurable = path.resolve(durableDataDir);
    if (resolvedJob === resolvedDurable || resolvedJob.startsWith(resolvedDurable + path.sep)) {
        throw new Error("job path must not be under durable dataFolder");
    }
}
exports.assertJobPathNotUnderDurableDataFolder = assertJobPathNotUnderDurableDataFolder;
