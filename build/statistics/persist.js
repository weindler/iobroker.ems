"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.writeStatisticsPersist = exports.readStatisticsPersist = exports.emptyDayRecord = exports.emptyPersist = exports.emptyRuntime = exports.STATISTICS_PERSIST_CATEGORY = exports.STATISTICS_PERSIST_FILE = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const types_1 = require("./types");
const compute_1 = require("./compute");
exports.STATISTICS_PERSIST_FILE = "statistics_v1.json";
exports.STATISTICS_PERSIST_CATEGORY = "statistics";
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
        return parsed;
    }
    catch {
        return emptyPersist();
    }
}
exports.readStatisticsPersist = readStatisticsPersist;
async function writeStatisticsPersist(dir, data) {
    await (0, promises_1.mkdir)(dir, { recursive: true });
    data.generatedAt = new Date().toISOString();
    await (0, promises_1.writeFile)((0, node_path_1.join)(dir, exports.STATISTICS_PERSIST_FILE), JSON.stringify(data, null, 2), "utf8");
}
exports.writeStatisticsPersist = writeStatisticsPersist;
