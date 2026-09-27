"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeStatisticsPersist = exports.readStatisticsPersist = exports.atomicStatisticsWrite = exports.decodeStatistics = exports.UnsupportedStatisticsVersion = exports.emptyDayRecord = exports.emptyPersist = exports.emptyRuntime = exports.pruneStatisticsPersist = exports.STATISTICS_DAILY_RETENTION_DAYS = exports.STATISTICS_PERSIST_CATEGORY = exports.STATISTICS_PERSIST_FILE = void 0;
const promises_1 = require("node:fs/promises");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const types_1 = require("./types");
const compute_1 = require("./compute");
exports.STATISTICS_PERSIST_FILE = "statistics_v1.json";
exports.STATISTICS_PERSIST_CATEGORY = "statistics";
/** Buchhaltungs-Tageswerte: zehn Jahre, im Gegensatz zu 90/120 Tagen Detailtelemetrie. */
exports.STATISTICS_DAILY_RETENTION_DAYS = 3_660;
function validDateKey(value) {
    return /^\d{4}-\d{2}-\d{2}$/.test(value);
}
/**
 * Harte Obergrenze für den RAM-/SSD-Ledger. Noch nicht abgerechnete öffentliche
 * Ladesitzungen bleiben aus Datenintegritätsgründen auch jenseits des Cutoffs erhalten.
 */
function pruneStatisticsPersist(data, anchorDateKey, retainDays = exports.STATISTICS_DAILY_RETENTION_DAYS) {
    if (!validDateKey(anchorDateKey) || !(retainDays > 0))
        return data;
    const anchor = new Date(`${anchorDateKey}T12:00:00.000Z`);
    anchor.setUTCDate(anchor.getUTCDate() - (Math.floor(retainDays) - 1));
    const cutoff = anchor.toISOString().slice(0, 10);
    const days = {};
    for (const [dateKey, day] of Object.entries(data.days)) {
        const pendingInvoice = day.publicSessions?.some((session) => session.status === "pending_invoice") === true;
        if (!validDateKey(dateKey) || dateKey >= cutoff || pendingInvoice)
            days[dateKey] = day;
    }
    const monthRewardsBilling = {};
    for (const [monthKey, billing] of Object.entries(data.monthRewardsBilling ?? {})) {
        if (!/^\d{4}-\d{2}$/.test(monthKey) || monthKey >= cutoff.slice(0, 7)) {
            monthRewardsBilling[monthKey] = billing;
        }
    }
    return { ...data, days, monthRewardsBilling };
}
exports.pruneStatisticsPersist = pruneStatisticsPersist;
function emptyRuntime(dateKey) {
    return {
        dateKey,
        lastTickMs: null,
        gridImportEnergyBaselineKwh: null,
        gridExportEnergyBaselineKwh: null,
        integratedDynamicCostEur: 0,
        integratedGridImportKwhFromPower: 0,
        wallboxSessionEnergyBaselineKwh: null,
        homePvKwh: 0,
        homeGridKwh: 0,
        homePvCostEur: 0,
        homeGridCostEur: 0,
        lastVehicleSocPct: null,
        lastWallboxConnected: null,
        meterCaptureSinceIso: null,
    };
}
exports.emptyRuntime = emptyRuntime;
function emptyPersist(now = new Date()) {
    const dateKey = (0, compute_1.localDateKey)(now);
    return {
        version: types_1.STATISTICS_PERSIST_VERSION,
        generatedAt: now.toISOString(),
        days: {},
        monthRewardsBilling: {},
        runtime: emptyRuntime(dateKey),
    };
}
exports.emptyPersist = emptyPersist;
function emptyDayRecord(dateKey) {
    return {
        dateKey,
        home: (0, compute_1.emptyHomeDay)(dateKey),
        mobility: (0, compute_1.emptyMobilityDay)(dateKey),
        publicSessions: [],
    };
}
exports.emptyDayRecord = emptyDayRecord;
class UnsupportedStatisticsVersion extends Error {
}
exports.UnsupportedStatisticsVersion = UnsupportedStatisticsVersion;
function decodeStatistics(raw) {
    const parsed = JSON.parse(raw);
    if (!parsed || parsed.version !== types_1.STATISTICS_PERSIST_VERSION) {
        throw new UnsupportedStatisticsVersion("Unsupported statistics version; archive left unchanged");
    }
    if (!parsed.days || typeof parsed.days !== "object" || Array.isArray(parsed.days)) {
        throw new Error("Invalid statistics days");
    }
    for (const [key, day] of Object.entries(parsed.days)) {
        if (!validDateKey(key) || !day || day.dateKey !== key || !day.home || !day.mobility || !Array.isArray(day.publicSessions)) {
            throw new Error(`Invalid statistics day: ${key}`);
        }
    }
    parsed.runtime ??= emptyRuntime((0, compute_1.localDateKey)(new Date()));
    parsed.monthRewardsBilling ??= {};
    return parsed;
}
exports.decodeStatistics = decodeStatistics;
function isMissing(error) {
    return error?.code === "ENOENT";
}
/** Never truncate the only copy. Rename a flushed, same-directory temporary file. */
async function atomicStatisticsWrite(path, raw) {
    const temporary = `${path}.${(0, node_crypto_1.randomUUID)()}.tmp`;
    const handle = await (0, promises_1.open)(temporary, "wx", 0o600);
    try {
        await handle.writeFile(raw, "utf8");
        await handle.sync();
        await handle.close();
        await (0, promises_1.rename)(temporary, path);
    }
    finally {
        await handle.close().catch(() => undefined);
        await (0, promises_1.unlink)(temporary).catch((error) => { if (!isMissing(error))
            throw error; });
    }
}
exports.atomicStatisticsWrite = atomicStatisticsWrite;
async function readStatisticsPersist(dir) {
    const path = (0, node_path_1.join)(dir, exports.STATISTICS_PERSIST_FILE);
    let primaryError;
    try {
        return decodeStatistics(await (0, promises_1.readFile)(path, "utf8"));
    }
    catch (error) {
        if (error instanceof UnsupportedStatisticsVersion)
            throw error;
        primaryError = error;
    }
    try {
        return decodeStatistics(await (0, promises_1.readFile)(`${path}.bak`, "utf8"));
    }
    catch (error) {
        if (isMissing(primaryError) && isMissing(error))
            return emptyPersist();
        throw new Error("Statistics cannot be recovered; refusing to replace history with empty data", { cause: error });
    }
}
exports.readStatisticsPersist = readStatisticsPersist;
async function writeStatisticsPersist(dir, data) {
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const path = (0, node_path_1.join)(dir, exports.STATISTICS_PERSIST_FILE);
    // Validate input before touching either durable copy. Historical days are not pruned.
    const generatedAt = new Date().toISOString();
    const raw = JSON.stringify({ ...data, generatedAt }, null, 2);
    decodeStatistics(raw);
    let previous;
    try {
        previous = await (0, promises_1.readFile)(path, "utf8");
        decodeStatistics(previous);
    }
    catch (error) {
        if (error instanceof UnsupportedStatisticsVersion)
            throw error;
        if (!isMissing(error)) {
            // A corrupt primary must not replace a valid backup.
            previous = await (0, promises_1.readFile)(`${path}.bak`, "utf8");
            decodeStatistics(previous);
        }
    }
    if (previous !== undefined)
        await atomicStatisticsWrite(`${path}.bak`, previous);
    await atomicStatisticsWrite(path, raw);
    data.generatedAt = generatedAt;
}
exports.writeStatisticsPersist = writeStatisticsPersist;
