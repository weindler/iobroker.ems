"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.pruneConsumerDays = exports.mergeDayRecord = exports.upsertConsumerEntry = exports.ensureConsumerEntry = exports.writeConsumerStatsPersist = exports.readConsumerStatsPersist = exports.emptyConsumerStatsPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const constants_1 = require("../house_load/constants");
const day_1 = require("../energy_daily_rollup/day");
const buffer_1 = require("./buffer");
const types_1 = require("./types");
function emptyConsumerStatsPersist() {
    return { version: 1, generated_at: new Date().toISOString(), consumers: {} };
}
exports.emptyConsumerStatsPersist = emptyConsumerStatsPersist;
async function readConsumerStatsPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, types_1.CONSUMER_STATS_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.consumers && typeof parsed.consumers === "object") {
            return parsed;
        }
    }
    catch {
        // neue Datei beim ersten Schreiben
    }
    return emptyConsumerStatsPersist();
}
exports.readConsumerStatsPersist = readConsumerStatsPersist;
async function writeConsumerStatsPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    const next = {
        ...persist,
        generated_at: new Date().toISOString(),
    };
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, types_1.CONSUMER_STATS_FILENAME), `${JSON.stringify(next, null, 2)}\n`);
}
exports.writeConsumerStatsPersist = writeConsumerStatsPersist;
function ensureConsumerEntry(persist, consumerKey, nowMs) {
    const existing = persist.consumers[consumerKey];
    if (existing) {
        return { persist, entry: existing };
    }
    const entry = (0, buffer_1.emptyConsumerEntry)(consumerKey, nowMs);
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
exports.ensureConsumerEntry = ensureConsumerEntry;
function upsertConsumerEntry(persist, entry) {
    return {
        ...persist,
        consumers: {
            ...persist.consumers,
            [entry.consumerKey]: entry,
        },
    };
}
exports.upsertConsumerEntry = upsertConsumerEntry;
function mergeDayRecord(existing, incoming) {
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
exports.mergeDayRecord = mergeDayRecord;
function pruneConsumerDays(entry, retainDays = types_1.DEFAULT_RETENTION_DAYS, nowMs = Date.now()) {
    const cutoff = nowMs - retainDays * constants_1.MS_PER_DAY;
    const days = {};
    for (const [key, rec] of Object.entries(entry.days)) {
        if ((0, day_1.dateKeyToStartMs)(key) >= cutoff) {
            days[key] = rec;
        }
    }
    return { ...entry, days };
}
exports.pruneConsumerDays = pruneConsumerDays;
