"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureConsumerStatsStates = exports.consumerStatsStateIds = exports.consumerStatsBase = exports.consumerStatsConfigFor = exports.collectRecentDayMetrics = exports.resolveConsumerEffectivePowerW = exports.peekConsumerStatsEntry = exports.resetConsumerStatsCache = exports.flushConsumerStatsPersist = exports.tickConsumerStats = exports.initConsumerStatsForAddon = exports.initConsumerStatsForKey = exports.PERSIST_CATEGORY = void 0;
const buffer_1 = require("./buffer");
const config_1 = require("./config");
const ensure_states_1 = require("./ensure_states");
const publish_1 = require("./publish");
const persist_1 = require("./persist");
exports.PERSIST_CATEGORY = "learning/consumer_stats";
let persistCache = null;
let persistDirty = false;
function baseDir(host) {
    return host.getAbsolutePath?.(exports.PERSIST_CATEGORY);
}
async function loadPersist(host) {
    const dir = baseDir(host);
    if (!dir) {
        if (!persistCache) {
            persistCache = (0, persist_1.emptyConsumerStatsPersist)();
        }
        return persistCache;
    }
    if (!persistCache) {
        persistCache = await (0, persist_1.readConsumerStatsPersist)(dir);
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
    await (0, persist_1.writeConsumerStatsPersist)(dir, persistCache);
    persistDirty = false;
}
async function initConsumerStatsForKey(host, consumerKey) {
    if (!(0, config_1.consumerStatsConfigFor)(consumerKey, host.config)) {
        return;
    }
    await (0, ensure_states_1.ensureConsumerStatsStates)(host, consumerKey);
    await loadPersist(host);
}
exports.initConsumerStatsForKey = initConsumerStatsForKey;
/** @deprecated use initConsumerStatsForKey */
async function initConsumerStatsForAddon(host, addonId) {
    await initConsumerStatsForKey(host, addonId);
}
exports.initConsumerStatsForAddon = initConsumerStatsForAddon;
async function tickConsumerStats(host, input) {
    const config = (0, config_1.consumerStatsConfigFor)(input.consumerKey, host.config);
    if (!config) {
        return null;
    }
    let persist = await loadPersist(host);
    const ensured = (0, persist_1.ensureConsumerEntry)(persist, input.consumerKey, input.nowMs);
    persist = ensured.persist;
    let entry = (0, buffer_1.ingestConsumerStatsTick)(ensured.entry, input, config);
    entry = (0, persist_1.pruneConsumerDays)(entry, undefined, input.nowMs);
    const todayRec = (0, buffer_1.dayRecordFromEntry)(entry);
    if (todayRec) {
        entry = {
            ...entry,
            days: {
                ...entry.days,
                [todayRec.dateKey]: todayRec,
            },
        };
    }
    persist = (0, persist_1.upsertConsumerEntry)(persist, entry);
    persistCache = persist;
    persistDirty = true;
    const snapshot = (0, buffer_1.snapshotFromEntry)(entry, config, input.nowMs, input.deviceActive);
    await (0, publish_1.publishConsumerStats)(host, input.consumerKey, snapshot);
    await flushPersist(host);
    return snapshot;
}
exports.tickConsumerStats = tickConsumerStats;
async function flushConsumerStatsPersist(host) {
    await flushPersist(host);
}
exports.flushConsumerStatsPersist = flushConsumerStatsPersist;
function resetConsumerStatsCache() {
    persistCache = null;
    persistDirty = false;
}
exports.resetConsumerStatsCache = resetConsumerStatsCache;
/** Liest gecachte Consumer-Stats für eine Unit (nach initConsumerStatsForKey). */
async function peekConsumerStatsEntry(host, consumerKey) {
    const persist = await loadPersist(host);
    return persist.consumers[consumerKey];
}
exports.peekConsumerStatsEntry = peekConsumerStatsEntry;
var learned_power_1 = require("./learned_power");
Object.defineProperty(exports, "resolveConsumerEffectivePowerW", { enumerable: true, get: function () { return learned_power_1.resolveConsumerEffectivePowerW; } });
Object.defineProperty(exports, "collectRecentDayMetrics", { enumerable: true, get: function () { return learned_power_1.collectRecentDayMetrics; } });
var config_2 = require("./config");
Object.defineProperty(exports, "consumerStatsConfigFor", { enumerable: true, get: function () { return config_2.consumerStatsConfigFor; } });
var ensure_states_2 = require("./ensure_states");
Object.defineProperty(exports, "consumerStatsBase", { enumerable: true, get: function () { return ensure_states_2.consumerStatsBase; } });
Object.defineProperty(exports, "consumerStatsStateIds", { enumerable: true, get: function () { return ensure_states_2.consumerStatsStateIds; } });
Object.defineProperty(exports, "ensureConsumerStatsStates", { enumerable: true, get: function () { return ensure_states_2.ensureConsumerStatsStates; } });
