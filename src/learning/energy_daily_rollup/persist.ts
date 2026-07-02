import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MS_PER_DAY } from "../house_load/constants";
import { dateKeyToStartMs } from "./day";
import {
	DEFAULT_RETENTION_DAYS,
	ENERGY_DAILY_FILENAME,
	type DailyEnergyRecord,
	type DailyEnergySourcePersist,
	type EnergyDailyPersist,
} from "./types";

export function emptyEnergyDailyPersist(): EnergyDailyPersist {
	return { version: 1, generated_at: new Date().toISOString(), sources: {} };
}

export async function readEnergyDailyPersist(baseDir: string): Promise<EnergyDailyPersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, ENERGY_DAILY_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as EnergyDailyPersist;
		if (parsed?.version === 1 && parsed.sources && typeof parsed.sources === "object") {
			return parsed;
		}
	} catch {
		// neue Datei beim ersten Schreiben
	}
	return emptyEnergyDailyPersist();
}

export async function writeEnergyDailyPersist(
	baseDir: string,
	persist: EnergyDailyPersist,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const next: EnergyDailyPersist = {
		...persist,
		generated_at: new Date().toISOString(),
	};
	await fs.writeFile(
		path.join(baseDir, ENERGY_DAILY_FILENAME),
		`${JSON.stringify(next, null, 2)}\n`,
		"utf8",
	);
}

export function upsertSourcePersist(
	persist: EnergyDailyPersist,
	source: DailyEnergySourcePersist,
): EnergyDailyPersist {
	return {
		...persist,
		sources: {
			...persist.sources,
			[source.sourceKey]: source,
		},
	};
}

export function mergeDayRecord(
	existing: DailyEnergyRecord | undefined,
	incoming: DailyEnergyRecord,
): DailyEnergyRecord {
	if (!existing) {
		return incoming;
	}
	const useIncoming =
		incoming.lastSampleTs > existing.lastSampleTs ||
		(incoming.lastSampleTs === existing.lastSampleTs && incoming.kwh >= existing.kwh);
	return {
		dateKey: incoming.dateKey,
		kwh: useIncoming ? incoming.kwh : existing.kwh,
		lastSampleTs: Math.max(existing.lastSampleTs, incoming.lastSampleTs),
		sampleCount: existing.sampleCount + incoming.sampleCount,
	};
}

export function pruneSourceDays(
	source: DailyEnergySourcePersist,
	retainDays = DEFAULT_RETENTION_DAYS,
	nowMs = Date.now(),
): DailyEnergySourcePersist {
	const cutoff = nowMs - retainDays * MS_PER_DAY;
	const days: Record<string, DailyEnergyRecord> = {};
	for (const [key, rec] of Object.entries(source.days)) {
		if (dateKeyToStartMs(key) >= cutoff) {
			days[key] = rec;
		}
	}
	return { ...source, days };
}
