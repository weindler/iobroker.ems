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
exports.PV_BIAS_DAILY_RETENTION_DAYS = exports.PV_BIAS_DAILY_FILENAME = void 0;
exports.emptyDailyPersist = emptyDailyPersist;
exports.pruneDailyPersist = pruneDailyPersist;
exports.readDailyPersist = readDailyPersist;
exports.writeDailyPersist = writeDailyPersist;
exports.upsertDailyRecord = upsertDailyRecord;
exports.dailyRecord = dailyRecord;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
exports.PV_BIAS_DAILY_FILENAME = "pv_bias_daily_v1.json";
exports.PV_BIAS_DAILY_RETENTION_DAYS = 120;
function emptyDailyPersist() {
    return { version: 1, days: {} };
}
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
async function writeDailyPersist(baseDir, persist) {
    await fs.mkdir(baseDir, { recursive: true });
    const compacted = pruneDailyPersist(persist);
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, exports.PV_BIAS_DAILY_FILENAME), `${JSON.stringify(compacted, null, 2)}\n`);
}
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
function dailyRecord(persist, dateKey) {
    const row = persist.days[dateKey];
    if (!row) {
        return null;
    }
    return row;
}
