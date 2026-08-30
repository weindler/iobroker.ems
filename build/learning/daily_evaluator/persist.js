"use strict";
/**
 * BLOCK A — Persistenz. Getrennt von day_telemetry (eigene Kategorien):
 *   findings/YYYY-MM-DD.json  (support_only, rebuildable aus Telemetrie)
 *   scores/YYYY-MM-DD.json    (support_only, rebuildable aus Telemetrie)
 *   learning_state_v1.json    (restorewürdig — einziger Block-A-State mit Backup-Anspruch)
 */
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
exports.writeDailyEvaluatorLearningState = exports.loadDailyEvaluatorLearningState = exports.learningStatePath = exports.listEvaluatedDateKeys = exports.pruneDailyEvaluatorFiles = exports.readScoresDay = exports.writeScoresDay = exports.readFindingsDay = exports.writeFindingsDay = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const time_1 = require("../../operator/time");
const constants_1 = require("./constants");
const types_1 = require("./types");
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayFilePath(baseDir, dateKey) {
    return path.join(baseDir, `${dateKey}.json`);
}
async function writeFindingsDay(findingsBaseDir, dateKey, findings) {
    const payload = {
        module: constants_1.DAILY_EVALUATOR_MODULE,
        schemaVersion: constants_1.DAILY_EVALUATOR_SCHEMA_VERSION,
        dateKey,
        findings,
    };
    await (0, atomic_write_1.atomicWriteFile)(dayFilePath(findingsBaseDir, dateKey), `${JSON.stringify(payload)}\n`, {
        mode: atomic_write_1.DIAGNOSTIC_FILE_MODE,
    });
}
exports.writeFindingsDay = writeFindingsDay;
async function readFindingsDay(findingsBaseDir, dateKey) {
    try {
        const raw = await fs.readFile(dayFilePath(findingsBaseDir, dateKey), "utf8");
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed.findings) ? parsed.findings : [];
    }
    catch {
        return null;
    }
}
exports.readFindingsDay = readFindingsDay;
async function writeScoresDay(scoresBaseDir, record) {
    const payload = {
        module: constants_1.DAILY_EVALUATOR_MODULE,
        schemaVersion: constants_1.DAILY_EVALUATOR_SCHEMA_VERSION,
        dateKey: record.dateKey,
        record,
    };
    await (0, atomic_write_1.atomicWriteFile)(dayFilePath(scoresBaseDir, record.dateKey), `${JSON.stringify(payload)}\n`, {
        mode: atomic_write_1.DIAGNOSTIC_FILE_MODE,
    });
}
exports.writeScoresDay = writeScoresDay;
async function readScoresDay(scoresBaseDir, dateKey) {
    try {
        const raw = await fs.readFile(dayFilePath(scoresBaseDir, dateKey), "utf8");
        const parsed = JSON.parse(raw);
        return parsed.record ?? null;
    }
    catch {
        return null;
    }
}
exports.readScoresDay = readScoresDay;
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
async function pruneDir(baseDir, retainDays, todayDateKey) {
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
async function pruneDailyEvaluatorFiles(findingsBaseDir, scoresBaseDir, todayDateKey, retainDays = constants_1.DAILY_EVALUATOR_RETENTION_DAYS) {
    const removedFindings = await pruneDir(findingsBaseDir, retainDays, todayDateKey);
    const removedScores = await pruneDir(scoresBaseDir, retainDays, todayDateKey);
    return { removedFindings, removedScores };
}
exports.pruneDailyEvaluatorFiles = pruneDailyEvaluatorFiles;
async function listEvaluatedDateKeys(scoresBaseDir) {
    const keys = await listDayKeysOnDisk(scoresBaseDir);
    return new Set(keys);
}
exports.listEvaluatedDateKeys = listEvaluatedDateKeys;
function normalizeLearningState(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    if (o.module !== constants_1.DAILY_EVALUATOR_MODULE)
        return null;
    const empty = (0, types_1.emptyDailyEvaluatorLearningState)();
    return {
        ...empty,
        ...o,
        module: constants_1.DAILY_EVALUATOR_MODULE,
        schemaVersion: constants_1.DAILY_EVALUATOR_SCHEMA_VERSION,
    };
}
function learningStatePath(baseDir) {
    return path.join(baseDir, constants_1.DAILY_EVALUATOR_LEARNING_STATE_FILE);
}
exports.learningStatePath = learningStatePath;
async function loadDailyEvaluatorLearningState(baseDir) {
    if (!baseDir)
        return (0, types_1.emptyDailyEvaluatorLearningState)();
    try {
        const raw = await fs.readFile(learningStatePath(baseDir), "utf8");
        const parsed = normalizeLearningState(JSON.parse(raw));
        return parsed ?? (0, types_1.emptyDailyEvaluatorLearningState)();
    }
    catch {
        return (0, types_1.emptyDailyEvaluatorLearningState)();
    }
}
exports.loadDailyEvaluatorLearningState = loadDailyEvaluatorLearningState;
async function writeDailyEvaluatorLearningState(baseDir, state) {
    await (0, atomic_write_1.atomicWriteFile)(learningStatePath(baseDir), `${JSON.stringify(state)}\n`, {
        mode: atomic_write_1.DIAGNOSTIC_FILE_MODE,
    });
}
exports.writeDailyEvaluatorLearningState = writeDailyEvaluatorLearningState;
