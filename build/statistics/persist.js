"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeStatisticsPersist = exports.readStatisticsPersist = exports.emptyDayRecord = exports.emptyPersist = exports.emptyRuntime = exports.pruneStatisticsPersist = exports.STATISTICS_DAILY_RETENTION_DAYS = exports.STATISTICS_PERSIST_CATEGORY = exports.STATISTICS_PERSIST_FILE = void 0;
const promises_1 = require("node:fs/promises");
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
async function readStatisticsPersist(dir) {
    try {
        const raw = await (0, promises_1.readFile)((0, node_path_1.join)(dir, exports.STATISTICS_PERSIST_FILE), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.version !== types_1.STATISTICS_PERSIST_VERSION || !parsed.days) {
            return emptyPersist();
        }
        if (!parsed.runtime) {
            parsed.runtime = emptyRuntime((0, compute_1.localDateKey)(new Date()));
        }
        if (!parsed.monthRewardsBilling) {
            parsed.monthRewardsBilling = {};
        }
        return parsed;
    }
    catch {
        return emptyPersist();
    }
}
exports.readStatisticsPersist = readStatisticsPersist;
async function writeStatisticsPersist(dir, data) {
    await (0, promises_1.mkdir)(dir, { recursive: true });
    const anchor = validDateKey(data.runtime.dateKey) ? data.runtime.dateKey : (0, compute_1.localDateKey)(new Date());
    const compacted = pruneStatisticsPersist(data, anchor);
    /* Tick-Cache ebenfalls begrenzen; nicht erst nach Adapter-Neustart. */
    data.days = compacted.days;
    data.monthRewardsBilling = compacted.monthRewardsBilling;
    data.generatedAt = new Date().toISOString();
    await (0, promises_1.writeFile)((0, node_path_1.join)(dir, exports.STATISTICS_PERSIST_FILE), JSON.stringify(data, null, 2), "utf8");
}
exports.writeStatisticsPersist = writeStatisticsPersist;
