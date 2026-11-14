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
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyEnergyDailyPersist = emptyEnergyDailyPersist;
exports.readEnergyDailyPersist = readEnergyDailyPersist;
exports.writeEnergyDailyPersist = writeEnergyDailyPersist;
exports.upsertSourcePersist = upsertSourcePersist;
exports.mergeDayRecord = mergeDayRecord;
exports.pruneSourceDays = pruneSourceDays;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const constants_1 = require("../house_load/constants");
const day_1 = require("./day");
const types_1 = require("./types");
function emptyEnergyDailyPersist() {
    return { version: 1, generated_at: new Date().toISOString(), sources: {} };
}
async function readEnergyDailyPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, types_1.ENERGY_DAILY_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.sources && typeof parsed.sources === "object") {
            return parsed;
        }
    }
    catch {
        // neue Datei beim ersten Schreiben
    }
    return emptyEnergyDailyPersist();
}
async function writeEnergyDailyPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    const next = {
        ...persist,
        generated_at: new Date().toISOString(),
    };
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, types_1.ENERGY_DAILY_FILENAME), `${JSON.stringify(next, null, 2)}\n`);
}
function upsertSourcePersist(persist, source) {
    return {
        ...persist,
        sources: {
            ...persist.sources,
            [source.sourceKey]: source,
        },
    };
}
function mergeDayRecord(existing, incoming) {
    if (!existing) {
        return incoming;
    }
    const useIncoming = incoming.lastSampleTs > existing.lastSampleTs ||
        (incoming.lastSampleTs === existing.lastSampleTs && incoming.kwh >= existing.kwh);
    return {
        dateKey: incoming.dateKey,
        kwh: useIncoming ? incoming.kwh : existing.kwh,
        lastSampleTs: Math.max(existing.lastSampleTs, incoming.lastSampleTs),
        sampleCount: existing.sampleCount + incoming.sampleCount,
    };
}
function pruneSourceDays(source, retainDays = types_1.DEFAULT_RETENTION_DAYS, nowMs = Date.now()) {
    const cutoff = nowMs - retainDays * constants_1.MS_PER_DAY;
    const days = {};
    for (const [key, rec] of Object.entries(source.days)) {
        if ((0, day_1.dateKeyToStartMs)(key) >= cutoff) {
            days[key] = rec;
        }
    }
    return { ...source, days };
}
