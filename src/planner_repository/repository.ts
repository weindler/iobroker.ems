import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../persistence/atomic_write";
import {
	CANONICAL_DAILY_PLAN_FILE,
	CANONICAL_FORECAST_PLAN_FILE,
	JOB_RESULT_FILE,
	JOB_SUMMARY_FILE,
} from "../planner_paths/constants";
import type { PlannerPathLayout } from "../planner_paths/paths";
import type {
	PlannerCompactSummary,
	PlannerJobOutputValidation,
	PlannerPublishResult,
	PlannerWorkerResult,
} from "../planner_contracts/types";
import { validatePlannerWorkerResult } from "../planner_contracts/validate";
import { sha256File, sha256Hex, stableSemanticStringify } from "./hash";
import {
	type CanonicalDailyPlanV1,
	type CanonicalForecastPlanV1,
	validateCanonicalDailyPlan,
	validateCanonicalForecastPlan,
} from "./schema";

export interface PlannerPublishContext {
	jobId: string;
	expectedGeneration: number;
	isStale: boolean;
}

export class PlannerRepository {
	constructor(private readonly paths: PlannerPathLayout) {}

	async readCanonicalForecastPlan(): Promise<CanonicalForecastPlanV1 | null> {
		return this.readCanonicalPlanFile(this.paths.canonicalForecastPlanPath, validateCanonicalForecastPlan);
	}

	async readCanonicalDailyPlan(): Promise<CanonicalDailyPlanV1 | null> {
		return this.readCanonicalPlanFile(this.paths.canonicalDailyPlanPath, validateCanonicalDailyPlan);
	}

	async readCompactSummary(): Promise<PlannerCompactSummary | null> {
		const forecast = await this.readCanonicalForecastPlan();
		const daily = await this.readCanonicalDailyPlan();
		if (!forecast || !daily) return null;
		return {
			forecast: {
				status: forecast.status,
				revision: forecast.revision,
				horizonStart: forecast.horizon_start,
				horizonEnd: forecast.horizon_end,
				reasonDe: `Forecast revision ${forecast.revision}`,
			},
			daily: {
				status: daily.status,
				revision: daily.revision,
				date: daily.date,
				validUntil: daily.valid_until,
				reasonDe: `Daily plan ${daily.date}`,
			},
			quality: {
				forecast: forecast.status,
				daily: daily.status,
			},
		};
	}

	semanticRevision(forecast: CanonicalForecastPlanV1, daily: CanonicalDailyPlanV1): string {
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

	async validateJobOutput(jobId: string): Promise<PlannerJobOutputValidation> {
		const errors: string[] = [];
		const jobDir = this.paths.jobDir(jobId);
		const resultPath = path.join(jobDir, JOB_RESULT_FILE);
		const forecastPath = path.join(jobDir, CANONICAL_FORECAST_PLAN_FILE);
		const dailyPath = path.join(jobDir, CANONICAL_DAILY_PLAN_FILE);

		let resultRaw: string;
		try {
			resultRaw = await fs.readFile(resultPath, "utf8");
		} catch {
			return { valid: false, errors: ["result.json missing"] };
		}

		let parsed: unknown;
		try {
			parsed = JSON.parse(resultRaw);
		} catch {
			return { valid: false, errors: ["result.json invalid JSON"] };
		}

		const resultCheck = validatePlannerWorkerResult(parsed);
		if (!resultCheck.valid || !resultCheck.value) {
			return { valid: false, errors: resultCheck.errors };
		}
		const result = resultCheck.value;
		if (result.jobId !== jobId) {
			errors.push("result.jobId mismatch");
		}
		if (result.status !== "ok") {
			errors.push(`result.status is ${result.status}`);
		}

		let forecastDescriptor;
		let dailyDescriptor;
		try {
			const forecastHash = await sha256File(forecastPath);
			const dailyHash = await sha256File(dailyPath);
			const forecastStat = await fs.stat(forecastPath);
			const dailyStat = await fs.stat(dailyPath);
			forecastDescriptor = {
				fileName: CANONICAL_FORECAST_PLAN_FILE,
				byteSize: forecastStat.size,
				sha256: forecastHash,
			};
			dailyDescriptor = {
				fileName: CANONICAL_DAILY_PLAN_FILE,
				byteSize: dailyStat.size,
				sha256: dailyHash,
			};
		} catch {
			return { valid: false, errors: ["job plan files missing"] };
		}

		const matchDescriptor = (name: string, sha: string, size: number) => {
			const fd = result.files.find((f) => f.fileName === name);
			if (!fd) {
				errors.push(`result.files missing ${name}`);
				return;
			}
			if (fd.sha256 !== sha) errors.push(`sha256 mismatch for ${name}`);
			if (fd.byteSize !== size) errors.push(`byteSize mismatch for ${name}`);
		};
		matchDescriptor(CANONICAL_FORECAST_PLAN_FILE, forecastDescriptor.sha256, forecastDescriptor.byteSize);
		matchDescriptor(CANONICAL_DAILY_PLAN_FILE, dailyDescriptor.sha256, dailyDescriptor.byteSize);

		let forecastPlan: CanonicalForecastPlanV1 | undefined;
		let dailyPlan: CanonicalDailyPlanV1 | undefined;
		try {
			const forecastRaw = JSON.parse(await fs.readFile(forecastPath, "utf8"));
			const dailyRaw = JSON.parse(await fs.readFile(dailyPath, "utf8"));
			const fVal = validateCanonicalForecastPlan(forecastRaw);
			const dVal = validateCanonicalDailyPlan(dailyRaw);
			if (!fVal.valid) errors.push(...fVal.errors);
			else forecastPlan = fVal.plan;
			if (!dVal.valid) errors.push(...dVal.errors);
			else dailyPlan = dVal.plan;
		} catch {
			errors.push("plan file JSON parse failed");
		}

		if (forecastPlan && dailyPlan) {
			const expectedRevision = this.semanticRevision(forecastPlan, dailyPlan);
			if (result.semanticRevision !== expectedRevision) {
				errors.push("semanticRevision mismatch");
			}
		}

		return {
			valid: errors.length === 0,
			errors,
			forecastDescriptor,
			dailyDescriptor,
			result: resultCheck.value,
		};
	}

	/**
	 * Publish job output to canonical durable paths. Main process only.
	 * Worker must never call this.
	 */
	async publishCurrentJob(ctx: PlannerPublishContext): Promise<PlannerPublishResult> {
		if (ctx.isStale) {
			return { published: false, reason: "stale_generation" };
		}

		const validation = await this.validateJobOutput(ctx.jobId);
		if (!validation.valid || !validation.result) {
			return { published: false, reason: validation.errors.join("; ") || "validation_failed" };
		}

		const result = validation.result;
		if (result.jobId !== ctx.jobId) {
			return { published: false, reason: "job_id_mismatch" };
		}
		if (result.generation !== ctx.expectedGeneration) {
			return { published: false, reason: "generation_mismatch" };
		}
		if (result.status !== "ok") {
			return { published: false, reason: `status_${result.status}` };
		}

		const jobDir = this.paths.jobDir(ctx.jobId);
		const forecastSrc = path.join(jobDir, CANONICAL_FORECAST_PLAN_FILE);
		const dailySrc = path.join(jobDir, CANONICAL_DAILY_PLAN_FILE);

		try {
			const forecastContent = await fs.readFile(forecastSrc);
			const dailyContent = await fs.readFile(dailySrc);
			const forecastParsed = JSON.parse(forecastContent.toString("utf8"));
			const dailyParsed = JSON.parse(dailyContent.toString("utf8"));
			const fVal = validateCanonicalForecastPlan(forecastParsed);
			const dVal = validateCanonicalDailyPlan(dailyParsed);
			if (!fVal.valid || !dVal.valid) {
				return { published: false, reason: "schema_invalid_at_publish" };
			}

			await atomicWriteFile(this.paths.canonicalForecastPlanPath, forecastContent, {
				validate: () => {
					const check = validateCanonicalForecastPlan(JSON.parse(forecastContent.toString("utf8")));
					if (!check.valid) throw new Error(check.errors.join("; "));
				},
			});
			await atomicWriteFile(this.paths.canonicalDailyPlanPath, dailyContent, {
				validate: () => {
					const check = validateCanonicalDailyPlan(JSON.parse(dailyContent.toString("utf8")));
					if (!check.valid) throw new Error(check.errors.join("; "));
				},
			});

			await this.cleanupJobDir(jobDir, true);
			return { published: true, reason: "ok", semanticRevision: result.semanticRevision };
		} catch (e) {
			return { published: false, reason: `publish_failed:${String(e)}` };
		}
	}

	/**
	 * Simulation artifacts stay under runtime/simulations — never touch canonical durable files.
	 */
	async writeSimulationArtifacts(
		jobId: string,
		forecastContent: string,
		dailyContent: string,
	): Promise<void> {
		const simDir = this.paths.simulationDir(jobId);
		await fs.mkdir(simDir, { recursive: true, mode: 0o700 });
		await atomicWriteFile(path.join(simDir, CANONICAL_FORECAST_PLAN_FILE), forecastContent);
		await atomicWriteFile(path.join(simDir, CANONICAL_DAILY_PLAN_FILE), dailyContent);
	}

	async writeSeedCanonicalPlans(forecast: CanonicalForecastPlanV1, daily: CanonicalDailyPlanV1): Promise<void> {
		await fs.mkdir(this.paths.durablePlannerDir, { recursive: true, mode: 0o700 });
		await atomicWriteFile(
			this.paths.canonicalForecastPlanPath,
			`${JSON.stringify(forecast, null, 2)}\n`,
			{
				validate: () => {
					const check = validateCanonicalForecastPlan(forecast);
					if (!check.valid) throw new Error(check.errors.join("; "));
				},
			},
		);
		await atomicWriteFile(
			this.paths.canonicalDailyPlanPath,
			`${JSON.stringify(daily, null, 2)}\n`,
			{
				validate: () => {
					const check = validateCanonicalDailyPlan(daily);
					if (!check.valid) throw new Error(check.errors.join("; "));
				},
			},
		);
	}

	async cleanupJobDir(jobDir: string, removeSummary = false): Promise<void> {
		const names = await fs.readdir(jobDir).catch(() => [] as string[]);
		for (const name of names) {
			if (!removeSummary && (name === JOB_SUMMARY_FILE || name === JOB_RESULT_FILE)) continue;
			await fs.unlink(path.join(jobDir, name)).catch(() => undefined);
		}
		if (removeSummary) {
			await fs.rm(jobDir, { recursive: true, force: true }).catch(() => undefined);
		}
	}

	private async readCanonicalPlanFile<T>(
		filePath: string,
		validate: (raw: unknown) => { valid: boolean; plan?: T },
	): Promise<T | null> {
		try {
			const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
			const check = validate(raw);
			return check.valid && check.plan ? check.plan : null;
		} catch {
			return null;
		}
	}
}

export async function readJobResult(jobDir: string): Promise<PlannerWorkerResult | null> {
	try {
		const raw = JSON.parse(await fs.readFile(path.join(jobDir, JOB_RESULT_FILE), "utf8"));
		const check = validatePlannerWorkerResult(raw);
		return check.valid ? (check.value ?? null) : null;
	} catch {
		return null;
	}
}
