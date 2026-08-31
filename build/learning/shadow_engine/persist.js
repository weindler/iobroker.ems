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
exports.pruneShadowEngineFiles = exports.listShadowEvaluatedDateKeys = exports.readShadowDayRecord = exports.writeShadowDayRecord = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const time_1 = require("../../operator/time");
const constants_1 = require("./constants");
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayFilePath(baseDir, dateKey) {
    return path.join(baseDir, `${dateKey}.json`);
}
async function writeShadowDayRecord(baseDir, record) {
    await (0, atomic_write_1.atomicWriteFile)(dayFilePath(baseDir, record.dateKey), `${JSON.stringify(record)}\n`, {
        mode: atomic_write_1.DIAGNOSTIC_FILE_MODE,
    });
}
exports.writeShadowDayRecord = writeShadowDayRecord;
async function readShadowDayRecord(baseDir, dateKey) {
    try {
        const raw = await fs.readFile(dayFilePath(baseDir, dateKey), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
exports.readShadowDayRecord = readShadowDayRecord;
async function listDayKeysOnDisk(baseDir) {
    try {
        const names = await fs.readdir(baseDir);
        return names
            .filter((n) => n.endsWith(".json") && DATE_KEY_RE.test(n.replace(/\.json$/, "")))
            .map((n) => n.replace(/\.json$/, ""))
            .sort();
    }
    catch {
        return [];
    }
}
async function listShadowEvaluatedDateKeys(baseDir) {
    return new Set(await listDayKeysOnDisk(baseDir));
}
exports.listShadowEvaluatedDateKeys = listShadowEvaluatedDateKeys;
async function pruneShadowEngineFiles(baseDir, todayDateKey, retainDays = constants_1.SHADOW_ENGINE_RETENTION_DAYS) {
    const keys = await listDayKeysOnDisk(baseDir);
    if (keys.length <= retainDays)
        return [];
    let keep = keys;
    if (todayDateKey) {
        const cutoff = (0, time_1.addDaysToDateKey)(todayDateKey, -(retainDays - 1));
        keep = keys.filter((k) => k >= cutoff);
        if (keep.length === 0)
            keep = keys.slice(-retainDays);
        else if (keep.length > retainDays)
            keep = keep.slice(-retainDays);
    }
    else {
        keep = keys.slice(-retainDays);
    }
    const keepSet = new Set(keep);
    const removed = [];
    for (const k of keys) {
        if (keepSet.has(k))
            continue;
        await fs.unlink(dayFilePath(baseDir, k)).catch(() => undefined);
        removed.push(k);
    }
    return removed;
}
exports.pruneShadowEngineFiles = pruneShadowEngineFiles;
