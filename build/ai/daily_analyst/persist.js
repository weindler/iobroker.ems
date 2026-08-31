"use strict";
/**
 * Persistenz analog `daily_evaluator/persist.ts`: ein kleines JSON pro Tag (support_only —
 * rebuildable durch erneuten KI-Lauf mit denselben Eingabedaten, kein Backup-Anspruch).
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
exports.pruneAiAnalystFindings = exports.readAiAnalystDay = exports.writeAiAnalystDay = exports.AI_ANALYST_FINDINGS_CATEGORY = exports.AI_ANALYST_SCHEMA_VERSION = exports.AI_ANALYST_MODULE = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const time_1 = require("../../operator/time");
exports.AI_ANALYST_MODULE = "ai_daily_analyst";
exports.AI_ANALYST_SCHEMA_VERSION = 1;
exports.AI_ANALYST_FINDINGS_CATEGORY = "ai/daily_analyst/findings";
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayFilePath(baseDir, dateKey) {
    return path.join(baseDir, `${dateKey}.json`);
}
async function writeAiAnalystDay(baseDir, dateKey, data) {
    const payload = {
        module: exports.AI_ANALYST_MODULE,
        schemaVersion: exports.AI_ANALYST_SCHEMA_VERSION,
        dateKey,
        generatedAtIso: new Date().toISOString(),
        status: data.status,
        reasonDe: data.reasonDe,
        model: data.model,
        findings: data.findings,
    };
    await (0, atomic_write_1.atomicWriteFile)(dayFilePath(baseDir, dateKey), `${JSON.stringify(payload)}\n`, {
        mode: atomic_write_1.DIAGNOSTIC_FILE_MODE,
    });
}
exports.writeAiAnalystDay = writeAiAnalystDay;
async function readAiAnalystDay(baseDir, dateKey) {
    try {
        const raw = await fs.readFile(dayFilePath(baseDir, dateKey), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.module !== exports.AI_ANALYST_MODULE)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.readAiAnalystDay = readAiAnalystDay;
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
async function pruneAiAnalystFindings(baseDir, retainDays, todayDateKey) {
    const keys = await listDayKeysOnDisk(baseDir);
    if (keys.length <= retainDays)
        return [];
    let keep = keys;
    if (todayDateKey) {
        const cutoff = (0, time_1.addDaysToDateKey)(todayDateKey, -(retainDays - 1));
        keep = keys.filter((k) => k >= cutoff);
        if (keep.length === 0)
            keep = keys.slice(-retainDays);
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
exports.pruneAiAnalystFindings = pruneAiAnalystFindings;
