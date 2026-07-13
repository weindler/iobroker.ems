import * as fs from "node:fs/promises";
import * as path from "node:path";
import {
	CANONICAL_DAILY_PLAN_FILE,
	CANONICAL_FORECAST_PLAN_FILE,
	JOB_INPUT_FILE,
	JOB_REQUEST_FILE,
	JOB_RESULT_FILE,
	JOB_SUMMARY_FILE,
} from "../planner_paths/constants";
import { validatePlannerJobRequest } from "../planner_contracts/validate";
import type { PlannerJobRequest } from "../planner_contracts/types";
import { validatePlannerInputSnapshot } from "../planner_contracts/validate";
import { PLANNER_PREPARED_INPUT_FILE } from "../planner_preparation/constants";
import { preparePlannerFromSnapshot } from "../planner_preparation/prepare";
import { readAndValidatePlannerInputFile, writePreparedInput } from "../planner_preparation/validate";
import { PlannerInputValidationError } from "../planner_preparation/types";
import { sha256File, sha256Hex, stableSemanticStringify } from "../planner_repository/hash";
import type { CanonicalDailyPlanV1, CanonicalForecastPlanV1 } from "../planner_repository/schema";
import { validateCanonicalDailyPlan, validateCanonicalForecastPlan } from "../planner_repository/schema";

export interface WorkerJobOutcome {
	exitCode: number;
	message: string;
}

function buildStubForecastPlan(capturedAt: string, horizonEnd?: string): CanonicalForecastPlanV1 {
	return {
		schema_version: 1,
		revision: 1,
		generated_at: capturedAt,
		status: "ready",
		horizon_start: capturedAt,
		horizon_end: horizonEnd ?? capturedAt,
		slot_minutes: 15,
		slots: [{ start: capturedAt, end: horizonEnd ?? capturedAt, net_surplus_w: 0 }],
	};
}

function buildStubDailyPlan(capturedAt: string, date: string): CanonicalDailyPlanV1 {
	return {
		schema_version: 1,
		revision: 1,
		generated_at: capturedAt,
		status: "ready",
		date,
		valid_until: null,
		allocations: [{ addon_id: "battery", power_w: 0 }],
	};
}

function semanticRevision(forecast: CanonicalForecastPlanV1, daily: CanonicalDailyPlanV1): string {
	const payload = {
		forecast: {
			revision: forecast.revision,
			status: forecast.status,
			horizon_start: forecast.horizon_start,
			horizon_end: forecast.horizon_end,
			slot_count: forecast.slots.length,
		},
		daily: {
			revision: daily.revision,
			status: daily.status,
			date: daily.date,
			allocation_count: daily.allocations.length,
		},
	};
	return sha256Hex(stableSemanticStringify(payload));
}

async function removePreparedOutput(jobDir: string): Promise<void> {
	try {
		await fs.unlink(path.join(jobDir, PLANNER_PREPARED_INPUT_FILE));
	} catch {
		// absent is fine
	}
}

async function runLegacyStubJob(
	jobDir: string,
	inputParsed: unknown,
	request: PlannerJobRequest,
): Promise<WorkerJobOutcome> {
	const inputCheck = validatePlannerInputSnapshot(inputParsed);
	if (!inputCheck.valid || !inputCheck.value) {
		return { exitCode: 2, message: `invalid input: ${inputCheck.errors.join("; ")}` };
	}

	const capturedAt = inputCheck.value.capturedAt;
	const forecast = buildStubForecastPlan(capturedAt);
	const daily = buildStubDailyPlan(capturedAt, capturedAt.slice(0, 10));

	const forecastPath = path.join(jobDir, CANONICAL_FORECAST_PLAN_FILE);
	const dailyPath = path.join(jobDir, CANONICAL_DAILY_PLAN_FILE);
	const forecastJson = `${JSON.stringify(forecast, null, 2)}\n`;
	const dailyJson = `${JSON.stringify(daily, null, 2)}\n`;

	await fs.writeFile(forecastPath, forecastJson, { mode: 0o600 });
	await fs.writeFile(dailyPath, dailyJson, { mode: 0o600 });

	const fVal = validateCanonicalForecastPlan(forecast);
	const dVal = validateCanonicalDailyPlan(daily);
	if (!fVal.valid || !dVal.valid) {
		return { exitCode: 2, message: "internal stub plan schema invalid" };
	}

	const forecastHash = await sha256File(forecastPath);
	const dailyHash = await sha256File(dailyPath);
	const forecastStat = await fs.stat(forecastPath);
	const dailyStat = await fs.stat(dailyPath);
	const semRev = semanticRevision(forecast, daily);

	const summary = {
		forecast: {
			status: forecast.status,
			revision: forecast.revision,
			horizonStart: forecast.horizon_start,
			horizonEnd: forecast.horizon_end,
			reasonDe: "Phase-2 Test-Forecast",
		},
		daily: {
			status: daily.status,
			revision: daily.revision,
			date: daily.date,
			validUntil: daily.valid_until,
			reasonDe: "Phase-2 Test-Daily",
		},
		quality: {
			forecast: "test",
			daily: "test",
		},
	};

	const result = {
		schemaVersion: 1 as const,
		jobId: request.jobId,
		generation: request.generation,
		status: "ok" as const,
		semanticRevision: semRev,
		summary,
		allocations: [
			{
				addonId: "battery",
				status: "ready",
				revision: 1,
				nextAction: null,
				nextWindowStart: null,
				nextWindowEnd: null,
				powerW: 0,
				energyKwh: null,
				reasonDe: "Test-Allocation",
				payloadJson: "[]",
			},
		],
		files: [
			{
				fileName: CANONICAL_FORECAST_PLAN_FILE,
				byteSize: forecastStat.size,
				sha256: forecastHash,
			},
			{
				fileName: CANONICAL_DAILY_PLAN_FILE,
				byteSize: dailyStat.size,
				sha256: dailyHash,
			},
		],
	};

	const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
	const resultJson = `${JSON.stringify(result, null, 2)}\n`;
	await fs.writeFile(path.join(jobDir, JOB_SUMMARY_FILE), summaryJson, { mode: 0o600 });
	await fs.writeFile(path.join(jobDir, JOB_RESULT_FILE), resultJson, { mode: 0o600 });

	return { exitCode: 0, message: "ok legacy_stub" };
}

async function runSnapshotV2Job(
	jobDir: string,
	inputPath: string,
	request: PlannerJobRequest,
	options: { runtimePlannerDir?: string },
): Promise<WorkerJobOutcome> {
	await removePreparedOutput(jobDir);

	let snapshot;
	try {
		snapshot = await readAndValidatePlannerInputFile(inputPath);
	} catch (e) {
		await removePreparedOutput(jobDir);
		if (e instanceof PlannerInputValidationError) {
			return { exitCode: 2, message: `${e.code}: ${e.message}` };
		}
		return { exitCode: 2, message: String(e).slice(0, 480) };
	}

	let prepared;
	try {
		prepared = preparePlannerFromSnapshot(snapshot);
		const runtimeRoot = options.runtimePlannerDir ?? path.resolve(jobDir, "..", "..");
		await writePreparedInput(jobDir, prepared, { runtimeRootDir: runtimeRoot });
	} catch (e) {
		await removePreparedOutput(jobDir);
		return { exitCode: 2, message: String(e).slice(0, 480) };
	}

	const capturedAt = snapshot.capturedAt;
	const horizonEnd = prepared.horizonEnd;
	const forecast = buildStubForecastPlan(capturedAt, horizonEnd);
	const daily = buildStubDailyPlan(capturedAt, capturedAt.slice(0, 10));

	const forecastPath = path.join(jobDir, CANONICAL_FORECAST_PLAN_FILE);
	const dailyPath = path.join(jobDir, CANONICAL_DAILY_PLAN_FILE);
	const forecastJson = `${JSON.stringify(forecast, null, 2)}\n`;
	const dailyJson = `${JSON.stringify(daily, null, 2)}\n`;

	await fs.writeFile(forecastPath, forecastJson, { mode: 0o600 });
	await fs.writeFile(dailyPath, dailyJson, { mode: 0o600 });

	const fVal = validateCanonicalForecastPlan(forecast);
	const dVal = validateCanonicalDailyPlan(daily);
	if (!fVal.valid || !dVal.valid) {
		await removePreparedOutput(jobDir);
		return { exitCode: 2, message: "internal stub plan schema invalid" };
	}

	const forecastHash = await sha256File(forecastPath);
	const dailyHash = await sha256File(dailyPath);
	const preparedPath = path.join(jobDir, PLANNER_PREPARED_INPUT_FILE);
	const preparedHash = await sha256File(preparedPath);
	const forecastStat = await fs.stat(forecastPath);
	const dailyStat = await fs.stat(dailyPath);
	const preparedStat = await fs.stat(preparedPath);
	const semRev = semanticRevision(forecast, daily);

	const summary = {
		forecast: {
			status: forecast.status,
			revision: forecast.revision,
			horizonStart: forecast.horizon_start,
			horizonEnd: forecast.horizon_end,
			reasonDe: `Phase-3B Grid-Supply-Vorbereitung (${prepared.slots.length} Slots)`,
		},
		daily: {
			status: daily.status,
			revision: daily.revision,
			date: daily.date,
			validUntil: daily.valid_until,
			reasonDe: "Phase-3B Stub-Daily",
		},
		quality: {
			forecast: "prepared",
			daily: "stub",
		},
	};

	const result = {
		schemaVersion: 1 as const,
		jobId: request.jobId,
		generation: request.generation,
		status: "ok" as const,
		semanticRevision: semRev,
		summary,
		allocations: [
			{
				addonId: "battery",
				status: "ready",
				revision: 1,
				nextAction: null,
				nextWindowStart: null,
				nextWindowEnd: null,
				powerW: 0,
				energyKwh: null,
				reasonDe: "Phase-3B Stub-Allocation",
				payloadJson: "[]",
			},
		],
		files: [
			{
				fileName: CANONICAL_FORECAST_PLAN_FILE,
				byteSize: forecastStat.size,
				sha256: forecastHash,
			},
			{
				fileName: CANONICAL_DAILY_PLAN_FILE,
				byteSize: dailyStat.size,
				sha256: dailyHash,
			},
			{
				fileName: PLANNER_PREPARED_INPUT_FILE,
				byteSize: preparedStat.size,
				sha256: preparedHash,
			},
		],
	};

	const summaryJson = `${JSON.stringify(summary, null, 2)}\n`;
	const resultJson = `${JSON.stringify(result, null, 2)}\n`;
	await fs.writeFile(path.join(jobDir, JOB_SUMMARY_FILE), summaryJson, { mode: 0o600 });
	await fs.writeFile(path.join(jobDir, JOB_RESULT_FILE), resultJson, { mode: 0o600 });

	const revHint = ` rev=${snapshot.inputRevision.slice(0, 12)}`;
	return {
		exitCode: 0,
		message: `ok slots=${prepared.slots.length}${revHint}`,
	};
}

/**
 * Phase-3B worker job: explicit job kind routes to snapshot v2 preparation or isolated legacy stub mode.
 */
export async function runPlannerWorkerJob(
	jobDir: string,
	options: { runtimePlannerDir?: string } = {},
): Promise<WorkerJobOutcome> {
	const requestPath = path.join(jobDir, JOB_REQUEST_FILE);
	const inputPath = path.join(jobDir, JOB_INPUT_FILE);

	let requestRaw: string;
	let inputRaw: string;
	try {
		requestRaw = await fs.readFile(requestPath, "utf8");
		inputRaw = await fs.readFile(inputPath, "utf8");
	} catch (e) {
		return { exitCode: 2, message: `missing job files: ${String(e)}` };
	}

	let requestParsed: unknown;
	let inputParsed: unknown;
	try {
		requestParsed = JSON.parse(requestRaw);
		inputParsed = JSON.parse(inputRaw);
	} catch {
		return { exitCode: 2, message: "invalid JSON in request or input" };
	}

	const requestCheck = validatePlannerJobRequest(requestParsed);
	if (!requestCheck.valid || !requestCheck.value) {
		return { exitCode: 2, message: `invalid request: ${requestCheck.errors.join("; ")}` };
	}

	const request: PlannerJobRequest = requestCheck.value;

	if (request.mode === "explain") {
		return { exitCode: 0, message: "explain mode — no artifacts written" };
	}

	if (request.kind === "legacy_stub") {
		return runLegacyStubJob(jobDir, inputParsed, request);
	}

	if (request.kind === "planner_snapshot_v2") {
		return runSnapshotV2Job(jobDir, inputPath, request, options);
	}

	return { exitCode: 2, message: `unsupported job kind: ${String(request.kind)}` };
}

/** @deprecated Use runPlannerWorkerJob — kept for tests referencing Phase-2 name. */
export const runPlannerTestJob = runPlannerWorkerJob;
