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
exports.normalizeDayEvaluationStore = normalizeDayEvaluationStore;
exports.readDayEvaluationPersist = readDayEvaluationPersist;
exports.writeDayEvaluationPersist = writeDayEvaluationPersist;
exports.loadOrEmptyDayEvaluationStore = loadOrEmptyDayEvaluationStore;
exports.pruneDayEvaluationStore = pruneDayEvaluationStore;
exports.upsertDayEvaluationOnce = upsertDayEvaluationOnce;
exports.dayEvaluationExists = dayEvaluationExists;
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
async function readDayEvaluationPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, types_1.DAY_EVAL_PERSIST_FILE), "utf8");
        return normalizeDayEvaluationStore(JSON.parse(raw));
    }
    catch {
        return null;
    }
}
async function writeDayEvaluationPersist(baseDir, store) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, types_1.DAY_EVAL_PERSIST_FILE), `${JSON.stringify(store, null, 2)}\n`);
}
async function loadOrEmptyDayEvaluationStore(baseDir) {
    if (!baseDir)
        return (0, types_1.emptyDayEvaluationStore)();
    return (await readDayEvaluationPersist(baseDir)) ?? (0, types_1.emptyDayEvaluationStore)();
}
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
function dayEvaluationExists(store, date) {
    return store.days[date] != null;
}
