import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import type { ThermalRuntimeComputeResult, ThermalRuntimePersist } from "../thermal_runtime/types";

export const BOILER_MODULE_TAG = "thermal_boiler_learning_v1";

export async function writeThermalBoilerPersist(
	baseDir: string,
	result: ThermalRuntimeComputeResult,
	lastRun: string,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const payload: ThermalRuntimePersist = {
		generated_at: lastRun,
		module: BOILER_MODULE_TAG,
		samples: result.samples,
		runtime_hours_avg: result.runtimeHoursAvg,
		runtime_hours_median: result.runtimeHoursMedian,
		cooling_rate_c_per_h_avg: result.coolingRateCPerHAvg,
		by_season: result.bySeasonJson,
		by_day_type: result.byDayTypeJson,
		history: result.historyJson,
		health: result.health,
	};
	await atomicWriteFile(path.join(baseDir, "thermal_boiler_learning_v1.json"), `${JSON.stringify(payload, null, 2)}\n`);
}

export async function readThermalBoilerPersist(baseDir: string): Promise<ThermalRuntimePersist | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, "thermal_boiler_learning_v1.json"), "utf8");
		const parsed = JSON.parse(raw) as ThermalRuntimePersist;
		if (parsed.module !== BOILER_MODULE_TAG) return null;
		return parsed;
	} catch {
		return null;
	}
}
