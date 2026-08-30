"use strict";
/**
 * Tagesdatei-Persistenz für Day Telemetry (Schema 2).
 * Eine Datei pro lokalem Kalendertag: YYYY-MM-DD.json
 * Legacy-Monolith day_telemetry_v1.json wird einmalig migriert.
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
exports.DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT = exports.normalizeDayTelemetryStore = exports.assertDayRecordSlotWidth = exports.pruneDayTelemetryStore = exports.readDayTelemetryPersist = exports.writeDayTelemetryPersist = exports.loadOrEmptyDayTelemetryStore = exports.pruneDayTelemetryFiles = exports.migrateMonolithToDayFiles = exports.writeDayTelemetryDay = exports.readDayTelemetryDay = exports.normalizeDayRecord = exports.dayTelemetryPersistPath = exports.dayTelemetryDayPath = exports.dayTelemetryDayFileName = exports.DAY_TELEMETRY_CATEGORY = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const time_1 = require("../../operator/time");
const constants_1 = require("./constants");
Object.defineProperty(exports, "DAY_TELEMETRY_CATEGORY", { enumerable: true, get: function () { return constants_1.DAY_TELEMETRY_CATEGORY; } });
Object.defineProperty(exports, "DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT", { enumerable: true, get: function () { return constants_1.DAY_TELEMETRY_EVALUABLE_COVERAGE_PCT; } });
const types_1 = require("./types");
const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
function dayTelemetryDayFileName(dateKey) {
    return `${dateKey}.json`;
}
exports.dayTelemetryDayFileName = dayTelemetryDayFileName;
function dayTelemetryDayPath(baseDir, dateKey) {
    return path.join(baseDir, dayTelemetryDayFileName(dateKey));
}
exports.dayTelemetryDayPath = dayTelemetryDayPath;
/** @deprecated Monolith-Pfad — nur Migration/Inventar. */
function dayTelemetryPersistPath(baseDir) {
    return path.join(baseDir, constants_1.DAY_TELEMETRY_LEGACY_MONOLITH_FILE);
}
exports.dayTelemetryPersistPath = dayTelemetryPersistPath;
function asCoverageFields(day) {
    if (day.firstSampleMs === undefined)
        day.firstSampleMs = null;
    if (day.firstSampleIso === undefined)
        day.firstSampleIso = null;
    if (day.lastSampleMs === undefined)
        day.lastSampleMs = null;
    if (day.lastSampleIso === undefined)
        day.lastSampleIso = null;
    if (typeof day.observedSlotCount !== "number")
        day.observedSlotCount = 0;
    if (typeof day.coveragePct !== "number")
        day.coveragePct = 0;
    if (typeof day.evaluable !== "boolean")
        day.evaluable = false;
    /* Legacy Schema-1: qualityMask war number[] voller 0 (= falsch ok) */
    if (day.buckets?.qualityMask) {
        const qm = day.buckets.qualityMask;
        for (let i = 0; i < qm.length; i++) {
            /* Unbeobachtet: alle Energie-Buckets null und Maske 0 ohne Planner-Ref → null */
            if (qm[i] === 0 && day.buckets.plannedConsumersRef[i] == null) {
                const anyEnergy = day.buckets.pvKwh[i] != null ||
                    day.buckets.houseTotalKwh[i] != null ||
                    day.buckets.gridImportKwh[i] != null ||
                    day.buckets.gridExportKwh[i] != null ||
                    day.buckets.otherMeasuredConsumersKwh[i] != null ||
                    day.buckets.batteryChargedKwh[i] != null ||
                    day.buckets.priceCtPerKwh[i] != null;
                if (!anyEnergy) {
                    qm[i] = null;
                }
            }
        }
    }
    (0, types_1.refreshDayCoverage)(day);
    return day;
}
function normalizeDayRecord(raw, fallbackDateKey) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    const dateKey = typeof o.dateKey === "string" && DATE_KEY_RE.test(o.dateKey)
        ? o.dateKey
        : fallbackDateKey && DATE_KEY_RE.test(fallbackDateKey)
            ? fallbackDateKey
            : null;
    if (!dateKey)
        return null;
    if (typeof o.slotCount !== "number" || typeof o.startMs !== "number" || typeof o.endMs !== "number") {
        return null;
    }
    const day = o;
    day.dateKey = dateKey;
    if (!day.timezone)
        day.timezone = "Europe/Berlin";
    if (!day.slotWidthMs)
        day.slotWidthMs = constants_1.DAY_TELEMETRY_SLOT_MS;
    if (!day.buckets)
        return null;
    if (!Array.isArray(day.forecastSnapshots))
        day.forecastSnapshots = [];
    if (!Array.isArray(day.replanEvents))
        day.replanEvents = [];
    if (!Array.isArray(day.climateRunSegments))
        day.climateRunSegments = [];
    if (!Array.isArray(day.statusEvents))
        day.statusEvents = [];
    if (!Array.isArray(day.plannedConsumers))
        day.plannedConsumers = [];
    if (typeof day.complete !== "boolean")
        day.complete = false;
    return asCoverageFields(day);
}
exports.normalizeDayRecord = normalizeDayRecord;
async function readDayTelemetryDay(baseDir, dateKey) {
    try {
        const raw = await fs.readFile(dayTelemetryDayPath(baseDir, dateKey), "utf8");
        const parsed = JSON.parse(raw);
        /* Wrapper { day: ... } oder direkt DayRecord */
        const body = parsed && typeof parsed === "object" && "day" in parsed
            ? parsed.day
            : parsed;
        return normalizeDayRecord(body, dateKey);
    }
    catch {
        return null;
    }
}
exports.readDayTelemetryDay = readDayTelemetryDay;
async function writeDayTelemetryDay(baseDir, day) {
    (0, types_1.refreshDayCoverage)(day);
    const payload = {
        module: constants_1.DAY_TELEMETRY_MODULE,
        schemaVersion: constants_1.DAY_TELEMETRY_SCHEMA,
        updatedAtIso: new Date().toISOString(),
        day,
    };
    await (0, atomic_write_1.atomicWriteFile)(dayTelemetryDayPath(baseDir, day.dateKey), `${JSON.stringify(payload)}\n`, { mode: atomic_write_1.DIAGNOSTIC_FILE_MODE });
}
exports.writeDayTelemetryDay = writeDayTelemetryDay;
async function listDayKeysOnDisk(baseDir) {
    try {
        const names = await fs.readdir(baseDir);
        return names
            .filter((n) => DATE_KEY_RE.test(n.replace(/\.json$/, "")) && n.endsWith(".json"))
            .map((n) => n.replace(/\.json$/, ""))
            .sort();
    }
    catch {
        return [];
    }
}
/**
 * Einmalmigration: Monolith days[] → Tagesdateien.
 * Idempotent via Marker-Datei. Keine Werte erfinden.
 */
async function migrateMonolithToDayFiles(baseDir) {
    const marker = path.join(baseDir, constants_1.DAY_TELEMETRY_MONOLITH_MIGRATED_MARKER);
    try {
        await fs.access(marker);
        return { migrated: false, dayCount: 0 };
    }
    catch {
        /* Marker fehlt → Migration prüfen */
    }
    await fs.mkdir(baseDir, { recursive: true });
    const monolithPath = path.join(baseDir, constants_1.DAY_TELEMETRY_LEGACY_MONOLITH_FILE);
    let raw;
    try {
        raw = await fs.readFile(monolithPath, "utf8");
    }
    catch {
        await (0, atomic_write_1.atomicWriteFile)(marker, `${JSON.stringify({ migratedAtIso: new Date().toISOString(), dayCount: 0 })}\n`);
        return { migrated: false, dayCount: 0 };
    }
    let parsed;
    try {
        parsed = JSON.parse(raw);
    }
    catch {
        await fs.rename(monolithPath, `${monolithPath}.corrupt`).catch(() => undefined);
        await (0, atomic_write_1.atomicWriteFile)(marker, `${JSON.stringify({ migratedAtIso: new Date().toISOString(), corrupt: true })}\n`);
        return { migrated: false, dayCount: 0 };
    }
    const o = parsed;
    const daysObj = o.days && typeof o.days === "object" ? o.days : {};
    let dayCount = 0;
    for (const [dk, rawDay] of Object.entries(daysObj)) {
        if (!DATE_KEY_RE.test(dk))
            continue;
        const existing = await readDayTelemetryDay(baseDir, dk);
        if (existing)
            continue; /* Tagesdatei hat Vorrang — keine Doppelmigration */
        const day = normalizeDayRecord(rawDay, dk);
        if (!day)
            continue;
        await writeDayTelemetryDay(baseDir, day);
        dayCount++;
    }
    const bak = `${monolithPath}.migrated`;
    await fs.rename(monolithPath, bak).catch(async () => {
        await fs.unlink(monolithPath).catch(() => undefined);
    });
    await (0, atomic_write_1.atomicWriteFile)(marker, `${JSON.stringify({ migratedAtIso: new Date().toISOString(), dayCount, backup: path.basename(bak) })}\n`);
    return { migrated: true, dayCount };
}
exports.migrateMonolithToDayFiles = migrateMonolithToDayFiles;
async function pruneDayTelemetryFiles(baseDir, retainDays = constants_1.DAY_TELEMETRY_RETENTION_DAYS, todayDateKey) {
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
        await fs.unlink(dayTelemetryDayPath(baseDir, k)).catch(() => undefined);
        removed.push(k);
    }
    return removed;
}
exports.pruneDayTelemetryFiles = pruneDayTelemetryFiles;
/** In-Memory-Store aus Disk laden (für Tests / Cache-Hydration). */
async function loadOrEmptyDayTelemetryStore(baseDir) {
    if (!baseDir)
        return (0, types_1.emptyDayTelemetryStore)();
    await migrateMonolithToDayFiles(baseDir);
    const store = (0, types_1.emptyDayTelemetryStore)();
    const keys = await listDayKeysOnDisk(baseDir);
    for (const dk of keys) {
        const day = await readDayTelemetryDay(baseDir, dk);
        if (day)
            store.days[dk] = day;
    }
    store.updatedAtIso = new Date().toISOString();
    return store;
}
exports.loadOrEmptyDayTelemetryStore = loadOrEmptyDayTelemetryStore;
/**
 * Schreibt alle Tage im Store als Tagesdateien (Tests / Vollpersist).
 * Produktion: bevorzugt writeDayTelemetryDay für den aktiven Tag.
 */
async function writeDayTelemetryPersist(baseDir, store) {
    await fs.mkdir(baseDir, { recursive: true });
    for (const day of Object.values(store.days)) {
        await writeDayTelemetryDay(baseDir, day);
    }
}
exports.writeDayTelemetryPersist = writeDayTelemetryPersist;
/** @deprecated Kompatibilitätstests — liest alle Tagesdateien als Store. */
async function readDayTelemetryPersist(baseDir) {
    const store = await loadOrEmptyDayTelemetryStore(baseDir);
    if (Object.keys(store.days).length === 0) {
        /* leeres Dir ohne Marker/Dateien */
        try {
            await fs.access(baseDir);
        }
        catch {
            return null;
        }
    }
    return store;
}
exports.readDayTelemetryPersist = readDayTelemetryPersist;
/** In-Memory Retention (Cache); Dateien separat via pruneDayTelemetryFiles. */
function pruneDayTelemetryStore(store, retainDays = constants_1.DAY_TELEMETRY_RETENTION_DAYS, todayDateKey) {
    const keys = Object.keys(store.days).sort();
    if (keys.length <= retainDays)
        return store;
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
function assertDayRecordSlotWidth(day) {
    return day.slotWidthMs === constants_1.DAY_TELEMETRY_SLOT_MS;
}
exports.assertDayRecordSlotWidth = assertDayRecordSlotWidth;
function normalizeDayTelemetryStore(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    if (o.module !== constants_1.DAY_TELEMETRY_MODULE)
        return null;
    if (!o.days || typeof o.days !== "object")
        return null;
    const days = {};
    for (const [dk, v] of Object.entries(o.days)) {
        const day = normalizeDayRecord(v, dk);
        if (day)
            days[dk] = day;
    }
    return {
        module: constants_1.DAY_TELEMETRY_MODULE,
        schemaVersion: constants_1.DAY_TELEMETRY_SCHEMA,
        updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
        days,
    };
}
exports.normalizeDayTelemetryStore = normalizeDayTelemetryStore;
