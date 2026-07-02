import * as fs from "node:fs/promises";
import * as path from "node:path";
import { MS_PER_DAY } from "../battery_runtime/constants";
import { hourKeyToStartTs } from "./hour";
import {
	DEFAULT_RETENTION_DAYS,
	POWER_HOURLY_FILENAME,
	effectiveRollupMode,
	type PowerHourlyPersist,
	type PowerHourlyRecord,
	type PowerRollupMode,
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
			return normalizePersist(parsed);
		}
	} catch {
		// neue Datei beim ersten Schreiben
	}
	return emptyPowerHourlyPersist();
}

function normalizePersist(persist: PowerHourlyPersist): PowerHourlyPersist {
	const sources: Record<string, PowerSourcePersist> = {};
	for (const [key, source] of Object.entries(persist.sources)) {
		sources[key] = {
			...source,
			rollupMode: effectiveRollupMode(source),
			powerUnit: source.powerUnit ?? "W",
		};
	}
	return { ...persist, sources };
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

function mergeBidirectional(
	existing: PowerHourlyRecord,
	incoming: PowerHourlyRecord,
): PowerHourlyRecord {
	return {
		hourKey: incoming.hourKey,
		sampleCount: existing.sampleCount + incoming.sampleCount,
		lastSampleTs: Math.max(existing.lastSampleTs, incoming.lastSampleTs),
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
	};
}

function mergeUnidirectionalAvg(
	existing: PowerHourlyRecord,
	incoming: PowerHourlyRecord,
): PowerHourlyRecord {
	const sampleCount = existing.sampleCount + incoming.sampleCount;
	const sumPowerW = (existing.sumPowerW ?? 0) + (incoming.sumPowerW ?? 0);
	return {
		hourKey: incoming.hourKey,
		sampleCount,
		lastSampleTs: Math.max(existing.lastSampleTs, incoming.lastSampleTs),
		chargeSamples: 0,
		dischargeSamples: 0,
		maxChargeW: null,
		maxDischargeW: null,
		sumPowerW,
		avgPowerW: sampleCount > 0 ? Math.round(sumPowerW / sampleCount) : null,
	};
}

export function mergeHourRecord(
	existing: PowerHourlyRecord | undefined,
	incoming: PowerHourlyRecord,
	mode: PowerRollupMode,
): PowerHourlyRecord {
	if (!existing) {
		return incoming;
	}
	if (mode === "unidirectional_avg") {
		return mergeUnidirectionalAvg(existing, incoming);
	}
	return mergeBidirectional(existing, incoming);
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
