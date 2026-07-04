import { dayRecordFromEntry, ingestConsumerStatsTick, snapshotFromEntry } from "./buffer";
import { consumerStatsConfigFor } from "./config";
import { ensureConsumerStatsStates } from "./ensure_states";
import { publishConsumerStats } from "./publish";
import {
	ensureConsumerEntry,
	pruneConsumerDays,
	readConsumerStatsPersist,
	upsertConsumerEntry,
	writeConsumerStatsPersist,
} from "./persist";
import type {
	ConsumerStatsPersist,
	ConsumerStatsSnapshot,
	ConsumerStatsTickInput,
} from "./types";

export const PERSIST_CATEGORY = "learning/consumer_stats";

export type ConsumerStatsHost = {
	config?: unknown;
	getAbsolutePath?: (category?: string) => string;
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

let persistCache: ConsumerStatsPersist | null = null;
let persistDirty = false;

function baseDir(host: ConsumerStatsHost): string | undefined {
	return host.getAbsolutePath?.(PERSIST_CATEGORY);
}

async function loadPersist(host: ConsumerStatsHost): Promise<ConsumerStatsPersist> {
	const dir = baseDir(host);
	if (!dir) {
		return { version: 1, generated_at: new Date().toISOString(), consumers: {} };
	}
	if (!persistCache) {
		persistCache = await readConsumerStatsPersist(dir);
	}
	return persistCache;
}

async function flushPersist(host: ConsumerStatsHost): Promise<void> {
	if (!persistDirty || !persistCache) {
		return;
	}
	const dir = baseDir(host);
	if (!dir) {
		return;
	}
	await writeConsumerStatsPersist(dir, persistCache);
	persistDirty = false;
}

export async function initConsumerStatsForAddon(host: ConsumerStatsHost, addonId: string): Promise<void> {
	if (!consumerStatsConfigFor(addonId, host.config)) {
		return;
	}
	await ensureConsumerStatsStates(host, addonId);
	await loadPersist(host);
}

export async function tickConsumerStats(
	host: ConsumerStatsHost,
	input: ConsumerStatsTickInput,
): Promise<ConsumerStatsSnapshot | null> {
	const config = consumerStatsConfigFor(input.consumerKey, host.config);
	if (!config) {
		return null;
	}

	let persist = await loadPersist(host);
	const ensured = ensureConsumerEntry(persist, input.consumerKey, input.nowMs);
	persist = ensured.persist;
	let entry = ingestConsumerStatsTick(ensured.entry, input, config);
	entry = pruneConsumerDays(entry, undefined, input.nowMs);

	const todayRec = dayRecordFromEntry(entry);
	if (todayRec) {
		entry = {
			...entry,
			days: {
				...entry.days,
				[todayRec.dateKey]: todayRec,
			},
		};
	}

	persist = upsertConsumerEntry(persist, entry);
	persistCache = persist;
	persistDirty = true;

	const snapshot = snapshotFromEntry(entry, config, input.nowMs, input.deviceActive);
	await publishConsumerStats(host, input.consumerKey, snapshot);
	await flushPersist(host);
	return snapshot;
}

export async function flushConsumerStatsPersist(host: ConsumerStatsHost): Promise<void> {
	await flushPersist(host);
}

export function resetConsumerStatsCache(): void {
	persistCache = null;
	persistDirty = false;
}

export { consumerStatsConfigFor } from "./config";
export { consumerStatsBase, consumerStatsStateIds, ensureConsumerStatsStates } from "./ensure_states";
