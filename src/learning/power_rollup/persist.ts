import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MS_PER_DAY } from "../battery_runtime/constants";
import { hourKeyToStartTs } from "./hour";
import {
	DEFAULT_RETENTION_DAYS,
	POWER_HOURLY_FILENAME,
	type PowerHourlyPersist,
	type PowerHourlyRecord,
	type PowerSourcePersist,
} from "./types";

export function emptyPowerHourlyPersist(): PowerHourlyPersist {
	return { version: 1, generated_at: new Date().toISOString(), sources: {} };
}

export async function readPowerHourlyPersist(baseDir: string): Promise<PowerHourlyPersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, POWER_HOURLY_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as PowerHourlyPersist;
		if (parsed?.version === 1 && parsed.sources && typeof parsed.sources === "object") {
			return parsed;
		}
	} catch {
		// neue Datei beim ersten Schreiben
	}
	return emptyPowerHourlyPersist();
}

export async function writePowerHourlyPersist(
	baseDir: string,
	persist: PowerHourlyPersist,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const next: PowerHourlyPersist = {
		...persist,
		generated_at: new Date().toISOString(),
	};
	await fs.writeFile(
		path.join(baseDir, POWER_HOURLY_FILENAME),
		`${JSON.stringify(next, null, 2)}\n`,
		"utf8",
	);
}

export function upsertSourcePersist(
	persist: PowerHourlyPersist,
	source: PowerSourcePersist,
): PowerHourlyPersist {
	return {
		...persist,
		sources: {
			...persist.sources,
			[source.sourceKey]: source,
		},
	};
}

export function mergeHourRecord(
	existing: PowerHourlyRecord | undefined,
	incoming: PowerHourlyRecord,
): PowerHourlyRecord {
	if (!existing) return incoming;
	return {
		hourKey: incoming.hourKey,
		sampleCount: existing.sampleCount + incoming.sampleCount,
		chargeSamples: existing.chargeSamples + incoming.chargeSamples,
		dischargeSamples: existing.dischargeSamples + incoming.dischargeSamples,
		maxChargeW:
			existing.maxChargeW === null
				? incoming.maxChargeW
				: incoming.maxChargeW === null
					? existing.maxChargeW
					: Math.max(existing.maxChargeW, incoming.maxChargeW),
		maxDischargeW:
			existing.maxDischargeW === null
				? incoming.maxDischargeW
				: incoming.maxDischargeW === null
					? existing.maxDischargeW
					: Math.max(existing.maxDischargeW, incoming.maxDischargeW),
		lastSampleTs: Math.max(existing.lastSampleTs, incoming.lastSampleTs),
	};
}

export function pruneSourceHours(
	source: PowerSourcePersist,
	retainDays = DEFAULT_RETENTION_DAYS,
	nowMs = Date.now(),
): PowerSourcePersist {
	const cutoff = nowMs - retainDays * MS_PER_DAY;
	const hours: Record<string, PowerHourlyRecord> = {};
	for (const [key, rec] of Object.entries(source.hours)) {
		if (hourKeyToStartTs(key) >= cutoff) {
			hours[key] = rec;
		}
	}
	return { ...source, hours };
}
