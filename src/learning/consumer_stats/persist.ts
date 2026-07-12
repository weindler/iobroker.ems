import * as fs from "node:fs/promises";
import * as path from "node:path";
import { atomicWriteFile } from "../../persistence/atomic_write";
import { MS_PER_DAY } from "../house_load/constants";
import { dateKeyToStartMs } from "../energy_daily_rollup/day";
import { emptyConsumerEntry } from "./buffer";
import {
	CONSUMER_STATS_FILENAME,
	DEFAULT_RETENTION_DAYS,
	type ConsumerDayRecord,
	type ConsumerPersistEntry,
	type ConsumerStatsPersist,
} from "./types";

export function emptyConsumerStatsPersist(): ConsumerStatsPersist {
	return { version: 1, generated_at: new Date().toISOString(), consumers: {} };
}

export async function readConsumerStatsPersist(baseDir: string): Promise<ConsumerStatsPersist> {
	try {
		const raw = await fs.readFile(path.join(baseDir, CONSUMER_STATS_FILENAME), "utf8");
		const parsed = JSON.parse(raw) as ConsumerStatsPersist;
		if (parsed?.version === 1 && parsed.consumers && typeof parsed.consumers === "object") {
			return parsed;
		}
	} catch {
		// neue Datei beim ersten Schreiben
	}
	return emptyConsumerStatsPersist();
}

export async function writeConsumerStatsPersist(
	baseDir: string,
	persist: ConsumerStatsPersist,
): Promise<void> {
	await fs.mkdir(baseDir, { recursive: true });
	const next: ConsumerStatsPersist = {
		...persist,
		generated_at: new Date().toISOString(),
	};
	await atomicWriteFile(
		path.join(baseDir, CONSUMER_STATS_FILENAME),
		`${JSON.stringify(next, null, 2)}\n`,
	);
}

export function ensureConsumerEntry(
	persist: ConsumerStatsPersist,
	consumerKey: string,
	nowMs: number,
): { persist: ConsumerStatsPersist; entry: ConsumerPersistEntry } {
	const existing = persist.consumers[consumerKey];
	if (existing) {
		return { persist, entry: existing };
	}
	const entry = emptyConsumerEntry(consumerKey, nowMs);
	return {
		persist: {
			...persist,
			consumers: {
				...persist.consumers,
				[consumerKey]: entry,
			},
		},
		entry,
	};
}

export function upsertConsumerEntry(
	persist: ConsumerStatsPersist,
	entry: ConsumerPersistEntry,
): ConsumerStatsPersist {
	return {
		...persist,
		consumers: {
			...persist.consumers,
			[entry.consumerKey]: entry,
		},
	};
}

export function mergeDayRecord(
	existing: ConsumerDayRecord | undefined,
	incoming: ConsumerDayRecord,
): ConsumerDayRecord {
	if (!existing) {
		return incoming;
	}
	return {
		dateKey: incoming.dateKey,
		runtimeSec: Math.max(existing.runtimeSec, incoming.runtimeSec),
		energyKwh: Math.max(existing.energyKwh, incoming.energyKwh),
		lastTickMs: Math.max(existing.lastTickMs, incoming.lastTickMs),
	};
}

export function pruneConsumerDays(
	entry: ConsumerPersistEntry,
	retainDays = DEFAULT_RETENTION_DAYS,
	nowMs = Date.now(),
): ConsumerPersistEntry {
	const cutoff = nowMs - retainDays * MS_PER_DAY;
	const days: Record<string, ConsumerDayRecord> = {};
	for (const [key, rec] of Object.entries(entry.days)) {
		if (dateKeyToStartMs(key) >= cutoff) {
			days[key] = rec;
		}
	}
	return { ...entry, days };
}
