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
exports.assertDayRecordSlotWidth = exports.dayTelemetryPersistPath = exports.pruneDayTelemetryStore = exports.loadOrEmptyDayTelemetryStore = exports.writeDayTelemetryPersist = exports.readDayTelemetryPersist = exports.normalizeDayTelemetryStore = exports.DAY_TELEMETRY_CATEGORY = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const constants_1 = require("./constants");
Object.defineProperty(exports, "DAY_TELEMETRY_CATEGORY", { enumerable: true, get: function () { return constants_1.DAY_TELEMETRY_CATEGORY; } });
const types_1 = require("./types");
const time_1 = require("../../operator/time");
function normalizeDayTelemetryStore(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    if (o.module !== constants_1.DAY_TELEMETRY_MODULE || o.schemaVersion !== constants_1.DAY_TELEMETRY_SCHEMA)
        return null;
    if (!o.days || typeof o.days !== "object")
        return null;
    return {
        module: constants_1.DAY_TELEMETRY_MODULE,
        schemaVersion: constants_1.DAY_TELEMETRY_SCHEMA,
        updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
        days: o.days,
    };
}
exports.normalizeDayTelemetryStore = normalizeDayTelemetryStore;
async function readDayTelemetryPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, constants_1.DAY_TELEMETRY_PERSIST_FILE), "utf8");
        return normalizeDayTelemetryStore(JSON.parse(raw));
    }
    catch {
        return null;
    }
}
exports.readDayTelemetryPersist = readDayTelemetryPersist;
/** Kompakt ohne Pretty-Print — Größenbudget 90 Tage. */
async function writeDayTelemetryPersist(baseDir, store) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, constants_1.DAY_TELEMETRY_PERSIST_FILE), `${JSON.stringify(store)}\n`);
}
exports.writeDayTelemetryPersist = writeDayTelemetryPersist;
async function loadOrEmptyDayTelemetryStore(baseDir) {
    if (!baseDir)
        return (0, types_1.emptyDayTelemetryStore)();
    return (await readDayTelemetryPersist(baseDir)) ?? (0, types_1.emptyDayTelemetryStore)();
}
exports.loadOrEmptyDayTelemetryStore = loadOrEmptyDayTelemetryStore;
/**
 * Rolling Retention: behält die letzten retainDays lokalen Kalendertage.
 * Älteste dateKeys zuerst droppen.
 */
function pruneDayTelemetryStore(store, retainDays = constants_1.DAY_TELEMETRY_RETENTION_DAYS, todayDateKey) {
    const keys = Object.keys(store.days).sort();
    if (keys.length <= retainDays)
        return store;
    let keep = keys;
    if (todayDateKey) {
        const cutoff = (0, time_1.addDaysToDateKey)(todayDateKey, -(retainDays - 1));
        keep = keys.filter((k) => k >= cutoff);
        /* Falls Filter zu aggressiv (Lücken): fallback auf letzte N */
        if (keep.length === 0) {
            keep = keys.slice(-retainDays);
        }
        else if (keep.length > retainDays) {
            keep = keep.slice(-retainDays);
        }
    }
    else {
        keep = keys.slice(-retainDays);
    }
    const keepSet = new Set(keep);
    const days = {};
    for (const k of keys) {
        if (keepSet.has(k))
            days[k] = store.days[k];
    }
    return {
        ...store,
        days,
        updatedAtIso: new Date().toISOString(),
    };
}
exports.pruneDayTelemetryStore = pruneDayTelemetryStore;
function dayTelemetryPersistPath(baseDir) {
    return path.join(baseDir, constants_1.DAY_TELEMETRY_PERSIST_FILE);
}
exports.dayTelemetryPersistPath = dayTelemetryPersistPath;
function assertDayRecordSlotWidth(day) {
    return day.slotWidthMs === constants_1.DAY_TELEMETRY_SLOT_MS;
}
exports.assertDayRecordSlotWidth = assertDayRecordSlotWidth;
