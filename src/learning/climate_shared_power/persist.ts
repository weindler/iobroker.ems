import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import { CLIMATE_SHARED_POWER_FILENAME, type ClimateSharedPowerPersist, type ClimateSharedPowerStat } from "./types";

export function emptyClimateSharedPowerPersist(): ClimateSharedPowerPersist {
	return { version: 1, generatedAtIso: new Date().toISOString(), stats: {} };
}

export async function readClimateSharedPowerPersist(baseDir: string): Promise<ClimateSharedPowerPersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, CLIMATE_SHARED_POWER_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as ClimateSharedPowerPersist;
		if (parsed?.version === 1 && parsed.stats && typeof parsed.stats === "object") {
			return parsed;
		}
	} catch {
		// neue Datei beim ersten Schreiben
	}
	return emptyClimateSharedPowerPersist();
}

export async function writeClimateSharedPowerPersist(
	baseDir: string,
	stats: Record<string, ClimateSharedPowerStat>,
): Promise<ClimateSharedPowerPersist> {
	await fs.mkdir(baseDir, { recursive: true });
	const next: ClimateSharedPowerPersist = {
		version: 1,
		generatedAtIso: new Date().toISOString(),
		stats,
	};
	await atomicWriteFile(
		path.join(baseDir, CLIMATE_SHARED_POWER_FILENAME),
		`${JSON.stringify(next, null, 2)}\n`,
	);
	return next;
}
