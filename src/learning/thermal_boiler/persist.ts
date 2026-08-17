import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import type { ThermalRuntimeComputeResult, ThermalRuntimePersist } from "../thermal_runtime/types";

export const BOILER_MODULE_TAG = "thermal_boiler_learning_v1";
export const BOILER_SOURCE_KIND = "mapping.boiler_temp_c";

/**
 * Migration (v0.1.284): Alt-Dateien ohne `source_kind=mapping.boiler_temp_c`
 * werden verworfen. Vor dem Mapping-only-Fix konnte die Historie vom Admin-Alias
 * (Puffer) stammen — das darf nicht als Boiler-Wissen weiterlaufen.
 */
export type ThermalBoilerPersist = ThermalRuntimePersist & {
	source_kind?: string;
	source_state_id?: string;
};

export function isTrustedBoilerPersist(parsed: ThermalBoilerPersist | null | undefined): parsed is ThermalBoilerPersist {
	if (!parsed || parsed.module !== BOILER_MODULE_TAG) return false;
	if (parsed.source_kind !== BOILER_SOURCE_KIND) return false;
	return typeof parsed.source_state_id === "string" && parsed.source_state_id.trim().length > 0;
}

export async function writeThermalBoilerPersist(
	baseDir: string,
	result: ThermalRuntimeComputeResult,
	lastRun: string,
	sourceStateId: string,
): Promise<void> {
	const source = sourceStateId.trim();
	if (!source) return;
	await fs.mkdir(baseDir, { recursive: true });
	const payload: ThermalBoilerPersist = {
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
		source_kind: BOILER_SOURCE_KIND,
		source_state_id: source,
	};
	await atomicWriteFile(path.join(baseDir, "thermal_boiler_learning_v1.json"), `${JSON.stringify(payload, null, 2)}\n`);
}

export async function readThermalBoilerPersist(baseDir: string): Promise<ThermalBoilerPersist | null> {
	try {
		const raw = await fs.readFile(path.join(baseDir, "thermal_boiler_learning_v1.json"), "utf8");
		const parsed = JSON.parse(raw) as ThermalBoilerPersist;
		if (!isTrustedBoilerPersist(parsed)) return null;
		return parsed;
	} catch {
		return null;
	}
}
