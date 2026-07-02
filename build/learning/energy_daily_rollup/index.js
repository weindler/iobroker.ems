"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopEnergyDailyRollup = exports.fetchRollupDayKwh = exports.ensureEnergyDailyRollupForLearning = exports.handleEnergyDailyRollupStateChange = exports.tickEnergyDailyRollup = exports.initEnergyDailyRollup = void 0;
const state_util_1 = require("../../ems_light/state_util");
const backfill_1 = require("./backfill");
const buffer_1 = require("./buffer");
const day_1 = require("./day");
const persist_1 = require("./persist");
const registry_1 = require("./registry");
const PERSIST_CATEGORY = "learning/energy_daily_rollup";
let rollupHost = null;
let persistCache = null;
const sourceRuntimes = new Map();
const subscribedStateIds = new Set();
let persistDirty = false;
function baseDir(host) {
    return host.getAbsolutePath?.(PERSIST_CATEGORY);
}
async function loadPersist(host) {
    const dir = baseDir(host);
    if (!dir) {
        return { version: 1, generated_at: new Date().toISOString(), sources: {} };
    }
    if (!persistCache) {
        persistCache = await (0, persist_1.readEnergyDailyPersist)(dir);
    }
    return persistCache;
}
async function flushPersist(host) {
    if (!persistDirty || !persistCache) {
        return;
    }
    const dir = baseDir(host);
    if (!dir) {
        return;
    }
    await (0, persist_1.writeEnergyDailyPersist)(dir, persistCache);
    persistDirty = false;
}
function initBufferFromPersist(source, persist, nowMs) {
    const dateKey = (0, day_1.localDateKey)(new Date(nowMs));
    const src = persist.sources[source.sourceKey];
    const rec = src?.days[dateKey];
    if (!rec) {
        return (0, buffer_1.emptyDayBuffer)(dateKey);
    }
    return {
        dateKey,
        kwh: rec.kwh,
        lastSampleTs: rec.lastSampleTs,
        sampleCount: rec.sampleCount,
    };
}
async function readLiveRawKwh(host, stateId) {
    try {
        const st = host.getForeignStateAsync
            ? await host.getForeignStateAsync(stateId)
            : await host.getStateAsync(stateId);
        return (0, state_util_1.asNum)(st?.val);
    }
    catch {
        return null;
    }
}
function finalizeDayBuffer(persist, source, buffer) {
    const record = (0, buffer_1.bufferToDayRecord)(buffer);
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
    days[record.dateKey] = (0, persist_1.mergeDayRecord)(days[record.dateKey], record);
    return (0, persist_1.upsertSourcePersist)(persist, {
        ...existing,
        stateId: source.stateId,
        days,
    });
}
async function processSample(host, source, ts, rawKwh) {
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
    const newDateKey = (0, day_1.localDateKey)(new Date(ts));
    if (prevDateKey !== newDateKey && runtime.buffer.sampleCount > 0) {
        const persist = await loadPersist(host);
        persistCache = finalizeDayBuffer(persist, source, runtime.buffer);
        persistDirty = true;
        runtime.buffer = (0, buffer_1.emptyDayBuffer)(newDateKey);
    }
    runtime.buffer = (0, buffer_1.ingestDailyKwhSample)(runtime.buffer, ts, rawKwh);
}
function syncSources(host, persist) {
    const sources = (0, registry_1.resolveDailyEnergySources)(host.config);
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
        }
        else {
            sourceRuntimes.get(source.sourceKey).source = source;
        }
    }
    return sources;
}
async function refreshSubscriptions(host, sources) {
    const needed = new Set(sources.map((s) => s.stateId));
    if (!host.subscribeForeignStatesAsync) {
        return;
    }
    for (const id of subscribedStateIds) {
        if (!needed.has(id) && host.unsubscribeForeignStatesAsync) {
            try {
                await host.unsubscribeForeignStatesAsync(id);
            }
            catch {
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
        }
        catch (e) {
            host.log.warn(`Energy-Daily-Rollup subscribe ${id}: ${e}`);
        }
    }
}
async function initEnergyDailyRollup(host) {
    rollupHost = host;
    persistCache = null;
    sourceRuntimes.clear();
    subscribedStateIds.clear();
    persistDirty = false;
    if (!baseDir(host)) {
        host.log.warn("Energy-Daily-Rollup: getAbsolutePath fehlt — Persistenz deaktiviert");
        return;
    }
    persistCache = await (0, persist_1.readEnergyDailyPersist)(baseDir(host));
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
exports.initEnergyDailyRollup = initEnergyDailyRollup;
async function tickEnergyDailyRollup(host) {
    if (!baseDir(host)) {
        return;
    }
    const persist = await loadPersist(host);
    const sources = syncSources(host, persist);
    await refreshSubscriptions(host, sources);
    const nowMs = Date.now();
    const currentDateKey = (0, day_1.localDateKey)(new Date(nowMs));
    for (const source of sources) {
        const runtime = sourceRuntimes.get(source.sourceKey);
        if (runtime && runtime.buffer.dateKey !== currentDateKey && runtime.buffer.sampleCount > 0) {
            const persist = await loadPersist(host);
            persistCache = finalizeDayBuffer(persist, source, runtime.buffer);
            persistDirty = true;
            runtime.buffer = (0, buffer_1.emptyDayBuffer)(currentDateKey);
        }
        const rawKwh = await readLiveRawKwh(host, source.stateId);
        if (rawKwh !== null) {
            await processSample(host, source, nowMs, rawKwh);
        }
    }
    if (persistDirty && persistCache) {
        for (const key of Object.keys(persistCache.sources)) {
            const src = persistCache.sources[key];
            persistCache = (0, persist_1.upsertSourcePersist)(persistCache, (0, persist_1.pruneSourceDays)(src));
        }
    }
    await flushPersist(host);
}
exports.tickEnergyDailyRollup = tickEnergyDailyRollup;
function handleEnergyDailyRollupStateChange(id, state) {
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
    const rawKwh = (0, state_util_1.asNum)(state.val);
    if (rawKwh === null) {
        return;
    }
    const ts = typeof state.ts === "number" ? state.ts : Date.now();
    void processSample(rollupHost, source.source, ts, rawKwh)
        .then(() => flushPersist(rollupHost))
        .catch((e) => {
        rollupHost?.log.warn(`Energy-Daily-Rollup ingest ${id}: ${e}`);
    });
}
exports.handleEnergyDailyRollupStateChange = handleEnergyDailyRollupStateChange;
async function ensureEnergyDailyRollupForLearning(host) {
    if (!baseDir(host)) {
        return;
    }
    const sources = (0, registry_1.resolveDailyEnergySources)(host.config);
    await (0, backfill_1.ensureEnergyDailyRollupBackfill)(host, sources);
    persistCache = null;
}
exports.ensureEnergyDailyRollupForLearning = ensureEnergyDailyRollupForLearning;
var read_1 = require("./read");
Object.defineProperty(exports, "fetchRollupDayKwh", { enumerable: true, get: function () { return read_1.fetchRollupDayKwh; } });
function stopEnergyDailyRollup() {
    rollupHost = null;
    persistCache = null;
    sourceRuntimes.clear();
    subscribedStateIds.clear();
    persistDirty = false;
}
exports.stopEnergyDailyRollup = stopEnergyDailyRollup;
