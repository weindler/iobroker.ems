import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import {
	CLIMATE_THERMAL_FILENAME,
	type ClimateThermalPersist,
	type ClimateThermalUnitModel,
} from "./types";

export function emptyClimateThermalPersist(): ClimateThermalPersist {
	return { version: 1, generatedAtIso: new Date().toISOString(), units: {} };
}

export async function readClimateThermalPersist(baseDir: string): Promise<ClimateThermalPersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, CLIMATE_THERMAL_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as ClimateThermalPersist;
		if (parsed?.version === 1 && parsed.units && typeof parsed.units === "object") {
			return parsed;
		}
	} catch {
		/* erste Datei */
	}
	return emptyClimateThermalPersist();
}

export async function writeClimateThermalPersist(
	baseDir: string,
	units: Record<string, ClimateThermalUnitModel>,
): Promise<ClimateThermalPersist> {
	await fs.mkdir(baseDir, { recursive: true });
	const next: ClimateThermalPersist = {
		version: 1,
		generatedAtIso: new Date().toISOString(),
		units,
	};
	await atomicWriteFile(path.join(baseDir, CLIMATE_THERMAL_FILENAME), `${JSON.stringify(next, null, 2)}\n`);
	return next;
}
