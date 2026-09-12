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
exports.dailyRecord = exports.upsertDailyRecord = exports.writeDailyPersist = exports.readDailyPersist = exports.pruneDailyPersist = exports.emptyDailyPersist = exports.PV_BIAS_DAILY_RETENTION_DAYS = exports.PV_BIAS_DAILY_FILENAME = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
exports.PV_BIAS_DAILY_FILENAME = "pv_bias_daily_v1.json";
exports.PV_BIAS_DAILY_RETENTION_DAYS = 120;
function emptyDailyPersist() {
    return { version: 1, days: {} };
}
exports.emptyDailyPersist = emptyDailyPersist;
function pruneDailyPersist(persist, retainDays = exports.PV_BIAS_DAILY_RETENTION_DAYS) {
    if (!(retainDays > 0))
        return persist;
    const keys = Object.keys(persist.days).sort();
    const keep = new Set(keys.slice(-Math.floor(retainDays)));
    const days = {};
    for (const key of keys) {
        if (keep.has(key))
            days[key] = persist.days[key];
    }
    return { ...persist, days };
}
exports.pruneDailyPersist = pruneDailyPersist;
async function readDailyPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, exports.PV_BIAS_DAILY_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.days && typeof parsed.days === "object") {
            return parsed;
        }
    }
    catch {
        // neue Datei beim ersten Schreiben
    }
    return emptyDailyPersist();
}
exports.readDailyPersist = readDailyPersist;
async function writeDailyPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    const compacted = pruneDailyPersist(persist);
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, exports.PV_BIAS_DAILY_FILENAME), `${JSON.stringify(compacted, null, 2)}\n`);
}
exports.writeDailyPersist = writeDailyPersist;
function upsertDailyRecord(persist, record) {
    return {
        ...persist,
        days: {
            ...persist.days,
            [record.date]: {
                ...persist.days[record.date],
                ...record,
                date: record.date,
            },
        },
    };
}
exports.upsertDailyRecord = upsertDailyRecord;
function dailyRecord(persist, dateKey) {
    const row = persist.days[dateKey];
    if (!row) {
        return null;
    }
    return row;
}
exports.dailyRecord = dailyRecord;
