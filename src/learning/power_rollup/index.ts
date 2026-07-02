import { asNum } from "../../ems_light/state_util";
import { ensurePowerRollupBackfill, type PowerRollupBackfillHost } from "./backfill";
import {
	bufferToHourRecord,
	emptyHourBuffer,
	ingestRollupSample,
} from "./buffer";
import { localHourKey } from "./hour";
import {
	mergeHourRecord,
	pruneSourceHours,
	readPowerHourlyPersist,
	upsertSourcePersist,
	writePowerHourlyPersist,
} from "./persist";
import { resolveDensePowerSources, type PowerRollupRegistryHost } from "./registry";
import {
	findSourceByStateId,
	isBidirectionalRollupSource,
	rollupSourceToHouseLoadSamples,
	rollupSourceToPowerPoints,
} from "./rollup_points";
import type { HourBuffer, PowerHourlyPersist, ResolvedDensePowerSource } from "./types";

const PERSIST_CATEGORY = "learning/power_rollup";

export type PowerRollupHost = PowerRollupBackfillHost & {
	namespace: string;
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	getForeignStateAsync?: (id: string) => Promise<ioBroker.State | null | undefined>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
	subscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
	unsubscribeForeignStatesAsync?: (pattern: string) => Promise<void>;
};

type SourceRuntime = {
	source: ResolvedDensePowerSource;
	buffer: HourBuffer;
};

let rollupHost: PowerRollupHost | null = null;
let persistCache: PowerHourlyPersist | null = null;
const sourceRuntimes = new Map<string, SourceRuntime>();
const subscribedStateIds = new Set<string>();
let persistDirty = false;

function baseDir(host: { getAbsolutePath?: (category?: string) => string }): string | undefined {
	return host.getAbsolutePath?.(PERSIST_CATEGORY);
}

async function loadPersist(host: { getAbsolutePath?: (category?: string) => string }): Promise<PowerHourlyPersist> {
	const dir = baseDir(host);
	if (!dir) {
		return { version: 1, generated_at: new Date().toISOString(), sources: {} };
	}
	if (!persistCache) {
		persistCache = await readPowerHourlyPersist(dir);
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
	await writePowerHourlyPersist(dir, persistCache);
	persistDirty = false;
}

function initBufferFromPersist(
	source: ResolvedDensePowerSource,
	persist: PowerHourlyPersist,
	nowMs: number,
): HourBuffer {
	const hourKey = localHourKey(nowMs);
	const src = persist.sources[source.sourceKey];
	const rec = src?.hours[hourKey];
	if (!rec) {
		return emptyHourBuffer(hourKey, source.rollupMode);
	}
	if (source.rollupMode === "unidirectional_avg") {
		return {
			hourKey,
			rollupMode: "unidirectional_avg",
			sampleCount: rec.sampleCount,
			chargeSamples: 0,
			dischargeSamples: 0,
			maxChargeW: null,
			maxDischargeW: null,
			sumPowerW: rec.sumPowerW ?? 0,
			lastSampleTs: rec.lastSampleTs,
		};
	}
	return {
		hourKey,
		rollupMode: "bidirectional_max",
		sampleCount: rec.sampleCount,
		chargeSamples: rec.chargeSamples,
		dischargeSamples: rec.dischargeSamples,
		maxChargeW: rec.maxChargeW,
		maxDischargeW: rec.maxDischargeW,
		sumPowerW: 0,
		lastSampleTs: rec.lastSampleTs,
	};
}

async function readLiveRawW(host: PowerRollupHost, stateId: string): Promise<number | null> {
	try {
		const st = host.getForeignStateAsync
			? await host.getForeignStateAsync(stateId)
			: await host.getStateAsync(stateId);
		return asNum(st?.val);
	} catch {
		return null;
	}
}

function finalizeHourBuffer(
	persist: PowerHourlyPersist,
	source: ResolvedDensePowerSource,
	buffer: HourBuffer,
): PowerHourlyPersist {
	const record = bufferToHourRecord(buffer);
	if (!record) {
		return persist;
	}
	const existing = persist.sources[source.sourceKey] ?? {
		sourceKey: source.sourceKey,
		stateId: source.stateId,
		rollupMode: source.rollupMode,
		powerInvert: source.powerInvert,
		powerUnit: source.powerUnit,
		backfillDone: false,
		hours: {},
	};
	const hours = { ...existing.hours };
	hours[record.hourKey] = mergeHourRecord(hours[record.hourKey], record, source.rollupMode);
	return upsertSourcePersist(persist, {
		...existing,
		stateId: source.stateId,
		rollupMode: source.rollupMode,
		powerInvert: source.powerInvert,
		powerUnit: source.powerUnit,
		hours,
	});
}

async function processSample(
	host: PowerRollupHost,
	source: ResolvedDensePowerSource,
	ts: number,
	rawW: number,
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

	const prevHourKey = runtime.buffer.hourKey;
	const newHourKey = localHourKey(ts);

	if (prevHourKey !== newHourKey && runtime.buffer.sampleCount > 0) {
		const persist = await loadPersist(host);
		persistCache = finalizeHourBuffer(persist, source, runtime.buffer);
		persistDirty = true;
		runtime.buffer = emptyHourBuffer(newHourKey, source.rollupMode);
	}

	runtime.buffer = ingestRollupSample(
		runtime.buffer,
		ts,
		rawW,
		source.rollupMode,
		source.powerInvert,
		source.powerUnit,
	);
}

async function refreshSubscriptions(host: PowerRollupHost, sources: ResolvedDensePowerSource[]): Promise<void> {
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
			host.log.warn(`Power-Rollup subscribe ${id}: ${e}`);
		}
	}
}

async function syncSources(host: PowerRollupHost): Promise<ResolvedDensePowerSource[]> {
	const sources = await resolveDensePowerSources(host);
	const activeKeys = new Set(sources.map((s) => s.sourceKey));

	for (const key of sourceRuntimes.keys()) {
		if (!activeKeys.has(key)) {
			sourceRuntimes.delete(key);
		}
	}

	const nowMs = Date.now();
	const persist = await loadPersist(host);
	for (const source of sources) {
		if (!sourceRuntimes.has(source.sourceKey)) {
			sourceRuntimes.set(source.sourceKey, {
				source,
				buffer: initBufferFromPersist(source, persist, nowMs),
			});
		} else {
			const rt = sourceRuntimes.get(source.sourceKey)!;
			rt.source = source;
		}
	}

	await refreshSubscriptions(host, sources);
	return sources;
}

export async function initPowerRollup(host: PowerRollupHost): Promise<void> {
	rollupHost = host;
	persistCache = null;
	sourceRuntimes.clear();
	subscribedStateIds.clear();
	persistDirty = false;

	if (!baseDir(host)) {
		host.log.warn("Power-Rollup: getAbsolutePath fehlt — Persistenz deaktiviert");
		return;
	}

	persistCache = await readPowerHourlyPersist(baseDir(host)!);
	const sources = await syncSources(host);
	const nowMs = Date.now();

	for (const source of sources) {
		const rawW = await readLiveRawW(host, source.stateId);
		if (rawW !== null) {
			await processSample(host, source, nowMs, rawW);
		}
	}

	host.log.info(`Power-Rollup ready (${sources.length} source(s))`);
}

export async function tickPowerRollup(host: PowerRollupHost): Promise<void> {
	if (!baseDir(host)) {
		return;
	}

	const sources = await syncSources(host);
	const nowMs = Date.now();
	const currentHourKey = localHourKey(nowMs);

	for (const source of sources) {
		const runtime = sourceRuntimes.get(source.sourceKey);
		if (runtime && runtime.buffer.hourKey !== currentHourKey && runtime.buffer.sampleCount > 0) {
			const persist = await loadPersist(host);
			persistCache = finalizeHourBuffer(persist, source, runtime.buffer);
			persistDirty = true;
			runtime.buffer = emptyHourBuffer(currentHourKey, source.rollupMode);
		}

		const rawW = await readLiveRawW(host, source.stateId);
		if (rawW !== null) {
			await processSample(host, source, nowMs, rawW);
		}
	}

	if (persistDirty && persistCache) {
		for (const key of Object.keys(persistCache.sources)) {
			const src = persistCache.sources[key];
			persistCache = upsertSourcePersist(persistCache, pruneSourceHours(src));
		}
	}

	await flushPersist(host);
}

export function handlePowerRollupStateChange(id: string, state: ioBroker.State | null): void {
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

	const rawW = asNum(state.val);
	if (rawW === null) {
		return;
	}

	const ts = typeof state.ts === "number" ? state.ts : Date.now();
	void processSample(rollupHost, source.source, ts, rawW)
		.then(() => flushPersist(rollupHost!))
		.catch((e) => {
			rollupHost?.log.warn(`Power-Rollup ingest ${id}: ${e}`);
		});
}

export async function ensurePowerRollupForLearning(
	host: PowerRollupBackfillHost & PowerRollupRegistryHost,
): Promise<void> {
	if (!baseDir(host)) {
		return;
	}
	const sources = await resolveDensePowerSources(host);
	await ensurePowerRollupBackfill(host, sources);
	persistCache = null;
}

export async function fetchRollupPowerHistory(
	host: { getAbsolutePath?: (category?: string) => string },
	stateId: string,
	lookbackDays: number,
): Promise<ReturnType<typeof rollupSourceToPowerPoints> | null> {
	const dir = host.getAbsolutePath?.(PERSIST_CATEGORY);
	if (!dir || !stateId) {
		return null;
	}
	const persist = await readPowerHourlyPersist(dir);
	const source = findSourceByStateId(persist, stateId);
	if (!source || !isBidirectionalRollupSource(source)) {
		return null;
	}
	const result = rollupSourceToPowerPoints(source, lookbackDays);
	if (result.points.length === 0) {
		return null;
	}
	return result;
}

export async function fetchRollupHouseLoadSamples(
	host: { getAbsolutePath?: (category?: string) => string },
	stateId: string,
	lookbackDays: number,
): Promise<ReturnType<typeof rollupSourceToHouseLoadSamples> | null> {
	const dir = host.getAbsolutePath?.(PERSIST_CATEGORY);
	if (!dir || !stateId) {
		return null;
	}
	const persist = await readPowerHourlyPersist(dir);
	const source = findSourceByStateId(persist, stateId);
	if (!source || source.rollupMode !== "unidirectional_avg") {
		return null;
	}
	const result = rollupSourceToHouseLoadSamples(source, lookbackDays);
	if (result.samples.length === 0) {
		return null;
	}
	return result;
}

export function stopPowerRollup(): void {
	rollupHost = null;
	persistCache = null;
	sourceRuntimes.clear();
	subscribedStateIds.clear();
	persistDirty = false;
}
