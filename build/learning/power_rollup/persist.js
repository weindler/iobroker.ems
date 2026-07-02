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
exports.pruneSourceHours = exports.mergeHourRecord = exports.upsertSourcePersist = exports.writePowerHourlyPersist = exports.readPowerHourlyPersist = exports.emptyPowerHourlyPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("../battery_runtime/constants");
const hour_1 = require("./hour");
const types_1 = require("./types");
function emptyPowerHourlyPersist() {
    return { version: 1, generated_at: new Date().toISOString(), sources: {} };
}
exports.emptyPowerHourlyPersist = emptyPowerHourlyPersist;
async function readPowerHourlyPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, types_1.POWER_HOURLY_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.sources && typeof parsed.sources === "object") {
            return normalizePersist(parsed);
        }
    }
    catch {
        // neue Datei beim ersten Schreiben
    }
    return emptyPowerHourlyPersist();
}
exports.readPowerHourlyPersist = readPowerHourlyPersist;
function normalizePersist(persist) {
    const sources = {};
    for (const [key, source] of Object.entries(persist.sources)) {
        sources[key] = {
            ...source,
            rollupMode: (0, types_1.effectiveRollupMode)(source),
            powerUnit: source.powerUnit ?? "W",
        };
    }
    return { ...persist, sources };
}
async function writePowerHourlyPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    const next = {
        ...persist,
        generated_at: new Date().toISOString(),
    };
    await fs.writeFile(path.join(baseDir, types_1.POWER_HOURLY_FILENAME), `${JSON.stringify(next, null, 2)}\n`, "utf8");
}
exports.writePowerHourlyPersist = writePowerHourlyPersist;
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
function mergeBidirectional(existing, incoming) {
    return {
        hourKey: incoming.hourKey,
        sampleCount: existing.sampleCount + incoming.sampleCount,
        lastSampleTs: Math.max(existing.lastSampleTs, incoming.lastSampleTs),
        chargeSamples: existing.chargeSamples + incoming.chargeSamples,
        dischargeSamples: existing.dischargeSamples + incoming.dischargeSamples,
        maxChargeW: existing.maxChargeW === null
            ? incoming.maxChargeW
            : incoming.maxChargeW === null
                ? existing.maxChargeW
                : Math.max(existing.maxChargeW, incoming.maxChargeW),
        maxDischargeW: existing.maxDischargeW === null
            ? incoming.maxDischargeW
            : incoming.maxDischargeW === null
                ? existing.maxDischargeW
                : Math.max(existing.maxDischargeW, incoming.maxDischargeW),
    };
}
function mergeUnidirectionalAvg(existing, incoming) {
    const sampleCount = existing.sampleCount + incoming.sampleCount;
    const sumPowerW = (existing.sumPowerW ?? 0) + (incoming.sumPowerW ?? 0);
    return {
        hourKey: incoming.hourKey,
        sampleCount,
        lastSampleTs: Math.max(existing.lastSampleTs, incoming.lastSampleTs),
        chargeSamples: 0,
        dischargeSamples: 0,
        maxChargeW: null,
        maxDischargeW: null,
        sumPowerW,
        avgPowerW: sampleCount > 0 ? Math.round(sumPowerW / sampleCount) : null,
    };
}
function mergeHourRecord(existing, incoming, mode) {
    if (!existing) {
        return incoming;
    }
    if (mode === "unidirectional_avg") {
        return mergeUnidirectionalAvg(existing, incoming);
    }
    return mergeBidirectional(existing, incoming);
}
exports.mergeHourRecord = mergeHourRecord;
function pruneSourceHours(source, retainDays = types_1.DEFAULT_RETENTION_DAYS, nowMs = Date.now()) {
    const cutoff = nowMs - retainDays * constants_1.MS_PER_DAY;
    const hours = {};
    for (const [key, rec] of Object.entries(source.hours)) {
        if ((0, hour_1.hourKeyToStartTs)(key) >= cutoff) {
            hours[key] = rec;
        }
    }
    return { ...source, hours };
}
exports.pruneSourceHours = pruneSourceHours;
