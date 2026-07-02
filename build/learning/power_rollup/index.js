"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopPowerRollup = exports.fetchRollupHouseLoadSamples = exports.fetchRollupPowerHistory = exports.ensurePowerRollupForLearning = exports.handlePowerRollupStateChange = exports.tickPowerRollup = exports.initPowerRollup = void 0;
const state_util_1 = require("../../ems_light/state_util");
const backfill_1 = require("./backfill");
const buffer_1 = require("./buffer");
const hour_1 = require("./hour");
const persist_1 = require("./persist");
const registry_1 = require("./registry");
const rollup_points_1 = require("./rollup_points");
const PERSIST_CATEGORY = "learning/power_rollup";
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
        persistCache = await (0, persist_1.readPowerHourlyPersist)(dir);
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
    await (0, persist_1.writePowerHourlyPersist)(dir, persistCache);
    persistDirty = false;
}
function initBufferFromPersist(source, persist, nowMs) {
    const hourKey = (0, hour_1.localHourKey)(nowMs);
    const src = persist.sources[source.sourceKey];
    const rec = src?.hours[hourKey];
    if (!rec) {
        return (0, buffer_1.emptyHourBuffer)(hourKey, source.rollupMode);
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
async function readLiveRawW(host, stateId) {
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
function finalizeHourBuffer(persist, source, buffer) {
    const record = (0, buffer_1.bufferToHourRecord)(buffer);
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
    hours[record.hourKey] = (0, persist_1.mergeHourRecord)(hours[record.hourKey], record, source.rollupMode);
    return (0, persist_1.upsertSourcePersist)(persist, {
        ...existing,
        stateId: source.stateId,
        rollupMode: source.rollupMode,
        powerInvert: source.powerInvert,
        powerUnit: source.powerUnit,
        hours,
    });
}
async function processSample(host, source, ts, rawW) {
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
    const newHourKey = (0, hour_1.localHourKey)(ts);
    if (prevHourKey !== newHourKey && runtime.buffer.sampleCount > 0) {
        const persist = await loadPersist(host);
        persistCache = finalizeHourBuffer(persist, source, runtime.buffer);
        persistDirty = true;
        runtime.buffer = (0, buffer_1.emptyHourBuffer)(newHourKey, source.rollupMode);
    }
    runtime.buffer = (0, buffer_1.ingestRollupSample)(runtime.buffer, ts, rawW, source.rollupMode, source.powerInvert, source.powerUnit);
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
            host.log.warn(`Power-Rollup subscribe ${id}: ${e}`);
        }
    }
}
async function syncSources(host) {
    const sources = await (0, registry_1.resolveDensePowerSources)(host);
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
        }
        else {
            const rt = sourceRuntimes.get(source.sourceKey);
            rt.source = source;
        }
    }
    await refreshSubscriptions(host, sources);
    return sources;
}
async function initPowerRollup(host) {
    rollupHost = host;
    persistCache = null;
    sourceRuntimes.clear();
    subscribedStateIds.clear();
    persistDirty = false;
    if (!baseDir(host)) {
        host.log.warn("Power-Rollup: getAbsolutePath fehlt — Persistenz deaktiviert");
        return;
    }
    persistCache = await (0, persist_1.readPowerHourlyPersist)(baseDir(host));
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
exports.initPowerRollup = initPowerRollup;
async function tickPowerRollup(host) {
    if (!baseDir(host)) {
        return;
    }
    const sources = await syncSources(host);
    const nowMs = Date.now();
    const currentHourKey = (0, hour_1.localHourKey)(nowMs);
    for (const source of sources) {
        const runtime = sourceRuntimes.get(source.sourceKey);
        if (runtime && runtime.buffer.hourKey !== currentHourKey && runtime.buffer.sampleCount > 0) {
            const persist = await loadPersist(host);
            persistCache = finalizeHourBuffer(persist, source, runtime.buffer);
            persistDirty = true;
            runtime.buffer = (0, buffer_1.emptyHourBuffer)(currentHourKey, source.rollupMode);
        }
        const rawW = await readLiveRawW(host, source.stateId);
        if (rawW !== null) {
            await processSample(host, source, nowMs, rawW);
        }
    }
    if (persistDirty && persistCache) {
        for (const key of Object.keys(persistCache.sources)) {
            const src = persistCache.sources[key];
            persistCache = (0, persist_1.upsertSourcePersist)(persistCache, (0, persist_1.pruneSourceHours)(src));
        }
    }
    await flushPersist(host);
}
exports.tickPowerRollup = tickPowerRollup;
function handlePowerRollupStateChange(id, state) {
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
    const rawW = (0, state_util_1.asNum)(state.val);
    if (rawW === null) {
        return;
    }
    const ts = typeof state.ts === "number" ? state.ts : Date.now();
    void processSample(rollupHost, source.source, ts, rawW)
        .then(() => flushPersist(rollupHost))
        .catch((e) => {
        rollupHost?.log.warn(`Power-Rollup ingest ${id}: ${e}`);
    });
}
exports.handlePowerRollupStateChange = handlePowerRollupStateChange;
async function ensurePowerRollupForLearning(host) {
    if (!baseDir(host)) {
        return;
    }
    const sources = await (0, registry_1.resolveDensePowerSources)(host);
    await (0, backfill_1.ensurePowerRollupBackfill)(host, sources);
    persistCache = null;
}
exports.ensurePowerRollupForLearning = ensurePowerRollupForLearning;
async function fetchRollupPowerHistory(host, stateId, lookbackDays) {
    const dir = host.getAbsolutePath?.(PERSIST_CATEGORY);
    if (!dir || !stateId) {
        return null;
    }
    const persist = await (0, persist_1.readPowerHourlyPersist)(dir);
    const source = (0, rollup_points_1.findSourceByStateId)(persist, stateId);
    if (!source || !(0, rollup_points_1.isBidirectionalRollupSource)(source)) {
        return null;
    }
    const result = (0, rollup_points_1.rollupSourceToPowerPoints)(source, lookbackDays);
    if (result.points.length === 0) {
        return null;
    }
    return result;
}
exports.fetchRollupPowerHistory = fetchRollupPowerHistory;
async function fetchRollupHouseLoadSamples(host, stateId, lookbackDays) {
    const dir = host.getAbsolutePath?.(PERSIST_CATEGORY);
    if (!dir || !stateId) {
        return null;
    }
    const persist = await (0, persist_1.readPowerHourlyPersist)(dir);
    const source = (0, rollup_points_1.findSourceByStateId)(persist, stateId);
    if (!source || source.rollupMode !== "unidirectional_avg") {
        return null;
    }
    const result = (0, rollup_points_1.rollupSourceToHouseLoadSamples)(source, lookbackDays);
    if (result.samples.length === 0) {
        return null;
    }
    return result;
}
exports.fetchRollupHouseLoadSamples = fetchRollupHouseLoadSamples;
function stopPowerRollup() {
    rollupHost = null;
    persistCache = null;
    sourceRuntimes.clear();
    subscribedStateIds.clear();
    persistDirty = false;
}
exports.stopPowerRollup = stopPowerRollup;
