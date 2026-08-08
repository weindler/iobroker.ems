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
exports.dayEvaluationExists = exports.upsertDayEvaluationOnce = exports.pruneDayEvaluationStore = exports.loadOrEmptyDayEvaluationStore = exports.writeDayEvaluationPersist = exports.readDayEvaluationPersist = exports.normalizeDayEvaluationStore = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const types_1 = require("./types");
function normalizeDayEvaluationStore(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    if (o.module !== types_1.DAY_EVAL_MODULE || o.schemaVersion !== types_1.DAY_EVAL_SCHEMA)
        return null;
    if (!o.days || typeof o.days !== "object")
        return null;
    return {
        module: types_1.DAY_EVAL_MODULE,
        schemaVersion: types_1.DAY_EVAL_SCHEMA,
        updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
        days: o.days,
    };
}
exports.normalizeDayEvaluationStore = normalizeDayEvaluationStore;
async function readDayEvaluationPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, types_1.DAY_EVAL_PERSIST_FILE), "utf8");
        return normalizeDayEvaluationStore(JSON.parse(raw));
    }
    catch {
        return null;
    }
}
exports.readDayEvaluationPersist = readDayEvaluationPersist;
async function writeDayEvaluationPersist(baseDir, store) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, types_1.DAY_EVAL_PERSIST_FILE), `${JSON.stringify(store, null, 2)}\n`);
}
exports.writeDayEvaluationPersist = writeDayEvaluationPersist;
async function loadOrEmptyDayEvaluationStore(baseDir) {
    if (!baseDir)
        return (0, types_1.emptyDayEvaluationStore)();
    return (await readDayEvaluationPersist(baseDir)) ?? (0, types_1.emptyDayEvaluationStore)();
}
exports.loadOrEmptyDayEvaluationStore = loadOrEmptyDayEvaluationStore;
/** Rollierende Retention — älteste Tage zuerst entfernen. */
function pruneDayEvaluationStore(store, retainDays = types_1.DAY_EVAL_RETENTION_DAYS, nowMs = Date.now()) {
    const keys = Object.keys(store.days).sort();
    if (keys.length <= retainDays)
        return store;
    const drop = keys.slice(0, keys.length - retainDays);
    const days = { ...store.days };
    for (const k of drop)
        delete days[k];
    void nowMs;
    return { ...store, days, updatedAtIso: new Date().toISOString() };
}
exports.pruneDayEvaluationStore = pruneDayEvaluationStore;
/**
 * Idempotenter Upsert: existiert der Tag bereits → unverändert zurückgeben (closed).
 * Returns { store, inserted }.
 */
function upsertDayEvaluationOnce(store, record) {
    if (store.days[record.plan.date]) {
        return { store, inserted: false };
    }
    const next = {
        ...store,
        updatedAtIso: record.evaluatedAtIso,
        days: { ...store.days, [record.plan.date]: record },
    };
    return { store: pruneDayEvaluationStore(next), inserted: true };
}
exports.upsertDayEvaluationOnce = upsertDayEvaluationOnce;
function dayEvaluationExists(store, date) {
    return store.days[date] != null;
}
exports.dayEvaluationExists = dayEvaluationExists;
