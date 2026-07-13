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
import type { PlannerJobRequest } from "../planner_contracts/types";
import { validatePlannerInputSnapshot, validatePlannerJobRequest } from "../planner_contracts/validate";
import { sha256File, sha256Hex, stableSemanticStringify } from "../planner_repository/hash";
import type { CanonicalDailyPlanV1, CanonicalForecastPlanV1 } from "../planner_repository/schema";
import { validateCanonicalDailyPlan, validateCanonicalForecastPlan } from "../planner_repository/schema";

export interface TestJobOutcome {
	exitCode: number;
	message: string;
}

function buildTestForecastPlan(capturedAt: string): CanonicalForecastPlanV1 {
	return {
		schema_version: 1,
		revision: 1,
		generated_at: capturedAt,
		status: "ready",
		horizon_start: capturedAt,
		horizon_end: capturedAt,
		slot_minutes: 15,
		slots: [{ start: capturedAt, end: capturedAt, net_surplus_w: 0 }],
	};
}

function buildTestDailyPlan(capturedAt: string, date: string): CanonicalDailyPlanV1 {
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

/**
 * Phase-2 deterministic worker job: validates request/input, writes compact test plans + result.
 * Does not touch canonical durable paths.
 */
export async function runPlannerTestJob(jobDir: string): Promise<TestJobOutcome> {
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
	const inputCheck = validatePlannerInputSnapshot(inputParsed);
	if (!inputCheck.valid || !inputCheck.value) {
		return { exitCode: 2, message: `invalid input: ${inputCheck.errors.join("; ")}` };
	}

	const request: PlannerJobRequest = requestCheck.value;
	const input = inputCheck.value;

	if (request.mode === "explain") {
		return { exitCode: 0, message: "explain mode — no artifacts written" };
	}

	const forecast = buildTestForecastPlan(input.capturedAt);
	const daily = buildTestDailyPlan(input.capturedAt, input.capturedAt.slice(0, 10));

	const forecastPath = path.join(jobDir, CANONICAL_FORECAST_PLAN_FILE);
	const dailyPath = path.join(jobDir, CANONICAL_DAILY_PLAN_FILE);
	const forecastJson = `${JSON.stringify(forecast, null, 2)}\n`;
	const dailyJson = `${JSON.stringify(daily, null, 2)}\n`;

	await fs.writeFile(forecastPath, forecastJson, { mode: 0o600 });
	await fs.writeFile(dailyPath, dailyJson, { mode: 0o600 });

	const fVal = validateCanonicalForecastPlan(forecast);
	const dVal = validateCanonicalDailyPlan(daily);
	if (!fVal.valid || !dVal.valid) {
		return { exitCode: 2, message: "internal test plan schema invalid" };
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
		quality: { forecast: "test", daily: "test" },
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

	return { exitCode: 0, message: "ok" };
}
