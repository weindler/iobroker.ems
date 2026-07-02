import { asNum } from "../../ems_light/state_util";
import { ensureEnergyDailyRollupBackfill, type EnergyDailyBackfillHost } from "./backfill";
import { bufferToDayRecord, emptyDayBuffer, ingestDailyKwhSample } from "./buffer";
import { localDateKey } from "./day";
import {
	mergeDayRecord,
	pruneSourceDays,
	readEnergyDailyPersist,
	upsertSourcePersist,
	writeEnergyDailyPersist,
} from "./persist";
import { resolveDailyEnergySources, type EnergyDailyRegistryHost } from "./registry";
import type { DayBuffer, EnergyDailyPersist, ResolvedDailyEnergySource } from "./types";

const PERSIST_CATEGORY = "learning/energy_daily_rollup";

export type EnergyDailyRollupHost = EnergyDailyBackfillHost & {
	namespace: string;
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	subscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
};

type SourceRuntime = {
	source: ResolvedDailyEnergySource;
	buffer: DayBuffer;
};

let rollupHost: EnergyDailyRollupHost | null = null;
let persistCache: EnergyDailyPersist | null = null;
const sourceRuntimes = new Map<string, SourceRuntime>();
const subscribedStateIds = new Set<string>();
let persistDirty = false;

function baseDir(host: { getAbsolutePath?: (category?: string) => string }): string | undefined {
	return host.getAbsolutePath?.(PERSIST_CATEGORY);
}

async function loadPersist(host: { getAbsolutePath?: (category?: string) => string }): Promise<EnergyDailyPersist> {
	const dir = baseDir(host);
	if (!dir) {
		return { version: 1, generated_at: new Date().toISOString(), sources: {} };
	}
	if (!persistCache) {
		persistCache = await readEnergyDailyPersist(dir);
	}
	return persistCache;
}

async function flushPersist(host: { getAbsolutePath?: (category?: string) => string }): Promise<void> {
	if (!persistDirty || !persistCache) {
		return;
	}
	const dir = baseDir(host);
	if (!dir) {
		return;
	}
	await writeEnergyDailyPersist(dir, persistCache);
	persistDirty = false;
}

function initBufferFromPersist(
	source: ResolvedDailyEnergySource,
	persist: EnergyDailyPersist,
	nowMs: number,
): DayBuffer {
	const dateKey = localDateKey(new Date(nowMs));
	const src = persist.sources[source.sourceKey];
	const rec = src?.days[dateKey];
	if (!rec) {
		return emptyDayBuffer(dateKey);
	}
	return {
		dateKey,
		kwh: rec.kwh,
		lastSampleTs: rec.lastSampleTs,
		sampleCount: rec.sampleCount,
	};
}

async function readLiveRawKwh(host: EnergyDailyRollupHost, stateId: string): Promise<number | null> {
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

function finalizeDayBuffer(
	persist: EnergyDailyPersist,
	source: ResolvedDailyEnergySource,
	buffer: DayBuffer,
): EnergyDailyPersist {
	const record = bufferToDayRecord(buffer);
	if (!record) {
		return persist;
	}
	const existing = persist.sources[source.sourceKey] ?? {
		sourceKey: source.sourceKey,
		stateId: source.stateId,
		backfillDone: false,
		days: {},
	};
	const days = { ...existing.days };
	days[record.dateKey] = mergeDayRecord(days[record.dateKey], record);
	return upsertSourcePersist(persist, {
		...existing,
		stateId: source.stateId,
		days,
	});
}

async function processSample(
	host: EnergyDailyRollupHost,
	source: ResolvedDailyEnergySource,
	ts: number,
	rawKwh: number,
): Promise<void> {
	let runtime = sourceRuntimes.get(source.sourceKey);
	if (!runtime) {
		const persist = await loadPersist(host);
		runtime = {
			source,
			buffer: initBufferFromPersist(source, persist, ts),
		};
		sourceRuntimes.set(source.sourceKey, runtime);
	}

	const prevDateKey = runtime.buffer.dateKey;
	const newDateKey = localDateKey(new Date(ts));

	if (prevDateKey !== newDateKey && runtime.buffer.sampleCount > 0) {
		const persist = await loadPersist(host);
		persistCache = finalizeDayBuffer(persist, source, runtime.buffer);
		persistDirty = true;
		runtime.buffer = emptyDayBuffer(newDateKey);
	}

	runtime.buffer = ingestDailyKwhSample(runtime.buffer, ts, rawKwh);
}

function syncSources(host: EnergyDailyRollupHost, persist: EnergyDailyPersist): ResolvedDailyEnergySource[] {
	const sources = resolveDailyEnergySources(host.config);
	const activeKeys = new Set(sources.map((s) => s.sourceKey));

	for (const key of sourceRuntimes.keys()) {
		if (!activeKeys.has(key)) {
			sourceRuntimes.delete(key);
		}
	}

	const nowMs = Date.now();
	for (const source of sources) {
		if (!sourceRuntimes.has(source.sourceKey)) {
			sourceRuntimes.set(source.sourceKey, {
				source,
				buffer: initBufferFromPersist(source, persist, nowMs),
			});
		} else {
			sourceRuntimes.get(source.sourceKey)!.source = source;
		}
	}

	return sources;
}

async function refreshSubscriptions(host: EnergyDailyRollupHost, sources: ResolvedDailyEnergySource[]): Promise<void> {
	const needed = new Set(sources.map((s) => s.stateId));
	if (!host.subscribeForeignStatesAsync) {
		return;
	}

	for (const id of subscribedStateIds) {
		if (!needed.has(id) && host.unsubscribeForeignStatesAsync) {
			try {
				await host.unsubscribeForeignStatesAsync(id);
			} catch {
				// ignore
			}
			subscribedStateIds.delete(id);
		}
	}

	for (const id of needed) {
		if (subscribedStateIds.has(id)) {
			continue;
		}
		try {
			await host.subscribeForeignStatesAsync(id);
			subscribedStateIds.add(id);
		} catch (e) {
			host.log.warn(`Energy-Daily-Rollup subscribe ${id}: ${e}`);
		}
	}
}

export async function initEnergyDailyRollup(host: EnergyDailyRollupHost): Promise<void> {
	rollupHost = host;
	persistCache = null;
	sourceRuntimes.clear();
	subscribedStateIds.clear();
	persistDirty = false;

	if (!baseDir(host)) {
		host.log.warn("Energy-Daily-Rollup: getAbsolutePath fehlt — Persistenz deaktiviert");
		return;
	}

	persistCache = await readEnergyDailyPersist(baseDir(host)!);
	const persist = persistCache;
	const sources = syncSources(host, persist);
	await refreshSubscriptions(host, sources);
	const nowMs = Date.now();

	for (const source of sources) {
		const rawKwh = await readLiveRawKwh(host, source.stateId);
		if (rawKwh !== null) {
			await processSample(host, source, nowMs, rawKwh);
		}
	}

	host.log.info(`Energy-Daily-Rollup ready (${sources.length} source(s))`);
}

export async function tickEnergyDailyRollup(host: EnergyDailyRollupHost): Promise<void> {
	if (!baseDir(host)) {
		return;
	}

	const persist = await loadPersist(host);
	const sources = syncSources(host, persist);
	await refreshSubscriptions(host, sources);
	const nowMs = Date.now();
	const currentDateKey = localDateKey(new Date(nowMs));

	for (const source of sources) {
		const runtime = sourceRuntimes.get(source.sourceKey);
		if (runtime && runtime.buffer.dateKey !== currentDateKey && runtime.buffer.sampleCount > 0) {
			const persist = await loadPersist(host);
			persistCache = finalizeDayBuffer(persist, source, runtime.buffer);
			persistDirty = true;
			runtime.buffer = emptyDayBuffer(currentDateKey);
		}

		const rawKwh = await readLiveRawKwh(host, source.stateId);
		if (rawKwh !== null) {
			await processSample(host, source, nowMs, rawKwh);
		}
	}

	if (persistDirty && persistCache) {
		for (const key of Object.keys(persistCache.sources)) {
			const src = persistCache.sources[key];
			persistCache = upsertSourcePersist(persistCache, pruneSourceDays(src));
		}
	}

	await flushPersist(host);
}

export function handleEnergyDailyRollupStateChange(id: string, state: ioBroker.State | null): void {
	if (!rollupHost || !state) {
		return;
	}
	if (id.startsWith(`${rollupHost.namespace}.`)) {
		return;
	}
	if (!subscribedStateIds.has(id)) {
		return;
	}

	const source = [...sourceRuntimes.values()].find((rt) => rt.source.stateId === id);
	if (!source) {
		return;
	}

	const rawKwh = asNum(state.val);
	if (rawKwh === null) {
		return;
	}

	const ts = typeof state.ts === "number" ? state.ts : Date.now();
	void processSample(rollupHost, source.source, ts, rawKwh)
		.then(() => flushPersist(rollupHost!))
		.catch((e) => {
			rollupHost?.log.warn(`Energy-Daily-Rollup ingest ${id}: ${e}`);
		});
}

export async function ensureEnergyDailyRollupForLearning(
	host: EnergyDailyBackfillHost & EnergyDailyRegistryHost,
): Promise<void> {
	if (!baseDir(host)) {
		return;
	}
	const sources = resolveDailyEnergySources(host.config);
	await ensureEnergyDailyRollupBackfill(host, sources);
	persistCache = null;
}

export { fetchRollupDayKwh } from "./read";

export function stopEnergyDailyRollup(): void {
	rollupHost = null;
	persistCache = null;
	sourceRuntimes.clear();
	subscribedStateIds.clear();
	persistDirty = false;
}
