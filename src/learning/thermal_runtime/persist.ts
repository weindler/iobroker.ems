import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MODULE_TAG } from "./constants";
import type { ThermalRuntimeComputeResult, ThermalRuntimePersist } from "./types";

export async function writeThermalRuntimePersist(
	baseDir: string,
	result: ThermalRuntimeComputeResult,
	lastRun: string,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const payload: ThermalRuntimePersist = {
		generated_at: lastRun,
		module: MODULE_TAG,
		samples: result.samples,
		runtime_hours_avg: result.runtimeHoursAvg,
		runtime_hours_median: result.runtimeHoursMedian,
		cooling_rate_c_per_h_avg: result.coolingRateCPerHAvg,
		by_season: result.bySeasonJson,
		by_day_type: result.byDayTypeJson,
		history: result.historyJson,
		health: result.health,
	};
	await fs.writeFile(
		path.join(baseDir, "thermal_runtime_learning_v1.json"),
		`${JSON.stringify(payload, null, 2)}\n`,
		"utf8",
	);
}

export async function readThermalRuntimePersist(
	baseDir: string,
): Promise<ThermalRuntimePersist | null> {
	try {
		const raw = await fs.readFile(
			path.join(baseDir, "thermal_runtime_learning_v1.json"),
			"utf8",
		);
		return JSON.parse(raw) as ThermalRuntimePersist;
	} catch {
		return null;
	}
}
