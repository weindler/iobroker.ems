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
exports.pruneSourceDays = exports.mergeDayRecord = exports.upsertSourcePersist = exports.writeEnergyDailyPersist = exports.readEnergyDailyPersist = exports.emptyEnergyDailyPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("../house_load/constants");
const day_1 = require("./day");
const types_1 = require("./types");
function emptyEnergyDailyPersist() {
    return { version: 1, generated_at: new Date().toISOString(), sources: {} };
}
exports.emptyEnergyDailyPersist = emptyEnergyDailyPersist;
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
exports.readEnergyDailyPersist = readEnergyDailyPersist;
async function writeEnergyDailyPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    const next = {
        ...persist,
        generated_at: new Date().toISOString(),
    };
    await fs.writeFile(path.join(baseDir, types_1.ENERGY_DAILY_FILENAME), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
exports.writeEnergyDailyPersist = writeEnergyDailyPersist;
function upsertSourcePersist(persist, source) {
    return {
        ...persist,
        sources: {
            ...persist.sources,
            [source.sourceKey]: source,
        },
    };
}
exports.upsertSourcePersist = upsertSourcePersist;
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
exports.mergeDayRecord = mergeDayRecord;
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
exports.pruneSourceDays = pruneSourceDays;
