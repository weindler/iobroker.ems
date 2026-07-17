import * as path from "node:path";
import { assertPathWithinRoot, assertSafeRelativeSegment, resolveEmsPaths, type PathResolverInput } from "../backup_integration/paths";
import {
	CANONICAL_DAILY_PLAN_FILE,
	CANONICAL_FORECAST_PLAN_FILE,
	DURABLE_PLANNER_SEGMENT,
	RUNTIME_CANDIDATE_SEGMENT,
	RUNTIME_JOBS_SEGMENT,
	RUNTIME_PLANNER_SEGMENT,
	RUNTIME_SIMULATIONS_SEGMENT,
} from "./constants";

export interface PlannerPathLayout {
	/** Durable: ems.<instance>/planner/ — part of ioBroker dataFolder backup. */
	durablePlannerDir: string;
	canonicalForecastPlanPath: string;
	canonicalDailyPlanPath: string;
	/** Runtime: ems-runtime.<instance>/planner/ — excluded from dataFolder backup. */
	runtimePlannerDir: string;
	runtimeJobsDir: string;
	runtimeSimulationsDir: string;
	/** Non-canonical candidate area for shadow comparison only. */
	runtimeCandidateDir: string;
	jobDir: (jobId: string) => string;
	simulationDir: (jobId: string) => string;
	candidateJobDir: (jobId: string) => string;
}

function assertSafeJobId(jobId: string): void {
	assertSafeRelativeSegment(jobId);
	if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(jobId)) {
		throw new Error("invalid job id");
	}
}

/**
 * Central planner path layout. Job/simulation artifacts live exclusively under runtimeDataDir.
 */
export function resolvePlannerPaths(input: PathResolverInput): PlannerPathLayout {
	const ems = resolveEmsPaths(input);
	const durablePlannerDir = path.join(ems.durableDataDir, DURABLE_PLANNER_SEGMENT);
	const runtimePlannerDir = path.join(ems.runtimeDataDir, RUNTIME_PLANNER_SEGMENT);
	const runtimeJobsDir = path.join(runtimePlannerDir, RUNTIME_JOBS_SEGMENT);
	const runtimeSimulationsDir = path.join(runtimePlannerDir, RUNTIME_SIMULATIONS_SEGMENT);
	const runtimeCandidateDir = path.join(runtimePlannerDir, RUNTIME_CANDIDATE_SEGMENT);

	assertPathWithinRoot(durablePlannerDir, ems.durableDataDir);
	assertPathWithinRoot(runtimePlannerDir, ems.runtimeDataDir);
	assertPathWithinRoot(runtimeJobsDir, ems.runtimeDataDir);
	assertPathWithinRoot(runtimeSimulationsDir, ems.runtimeDataDir);
	assertPathWithinRoot(runtimeCandidateDir, ems.runtimeDataDir);

	return {
		durablePlannerDir,
		canonicalForecastPlanPath: path.join(durablePlannerDir, CANONICAL_FORECAST_PLAN_FILE),
		canonicalDailyPlanPath: path.join(durablePlannerDir, CANONICAL_DAILY_PLAN_FILE),
		runtimePlannerDir,
		runtimeJobsDir,
		runtimeSimulationsDir,
		runtimeCandidateDir,
		jobDir: (jobId: string) => {
			assertSafeJobId(jobId);
			const dir = path.join(runtimeJobsDir, jobId);
			assertPathWithinRoot(dir, ems.runtimeDataDir);
			return dir;
		},
		simulationDir: (jobId: string) => {
			assertSafeJobId(jobId);
			const dir = path.join(runtimeSimulationsDir, jobId);
			assertPathWithinRoot(dir, ems.runtimeDataDir);
			return dir;
		},
		candidateJobDir: (jobId: string) => {
			assertSafeJobId(jobId);
			const dir = path.join(runtimeCandidateDir, jobId);
			assertPathWithinRoot(dir, ems.runtimeDataDir);
			return dir;
		},
	};
}

/** Job artifacts must not live under the durable ioBroker dataFolder root. */
export function assertJobPathNotUnderDurableDataFolder(jobPath: string, durableDataDir: string): void {
	const resolvedJob = path.resolve(jobPath);
	const resolvedDurable = path.resolve(durableDataDir);
	if (resolvedJob === resolvedDurable || resolvedJob.startsWith(resolvedDurable + path.sep)) {
		throw new Error("job path must not be under durable dataFolder");
	}
}
