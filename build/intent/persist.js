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
exports.readIntentPersist = exports.writeIntentPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const aggregate_1 = require("./core/aggregate");
const types_1 = require("./thermal/types");
const types_2 = require("./battery/types");
const PERSIST_FILE = "intent_v1.json";
const LEGACY_WALLBOX_FILE = "wallbox_intent_v1.json";
async function writeIntentPersist(baseDir, payload) {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, PERSIST_FILE), `${JSON.stringify({
        module: "intent_v1",
        wallbox: payload.wallbox,
        thermal: payload.thermal,
        battery: payload.battery,
        resolved_all: payload.resolvedAll,
        last_request_ids: payload.lastRequestIds,
        wallbox_snapshot: payload.wallboxSnapshot,
        thermal_snapshot: payload.thermalSnapshot,
        battery_snapshot: payload.batterySnapshot,
    }, null, 2)}\n`, "utf8");
}
exports.writeIntentPersist = writeIntentPersist;
async function readIntentPersist(baseDir) {
    const modern = await readModernPersist(path.join(baseDir, PERSIST_FILE));
    if (modern)
        return modern;
    return readLegacyWallboxPersist(path.join(baseDir, LEGACY_WALLBOX_FILE));
}
exports.readIntentPersist = readIntentPersist;
async function readModernPersist(filePath) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed.wallbox)
            return null;
        return {
            wallbox: parsed.wallbox,
            thermal: parsed.thermal,
            battery: parsed.battery,
            resolvedAll: parsed.resolved_all,
            lastRequestIds: parsed.last_request_ids ?? { wallbox: null, thermal: null, battery: null },
            wallboxSnapshot: parsed.wallbox_snapshot ?? null,
            thermalSnapshot: parsed.thermal_snapshot ?? null,
            batterySnapshot: parsed.battery_snapshot ?? null,
        };
    }
    catch {
        return null;
    }
}
async function readLegacyWallboxPersist(filePath) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed.resolved)
            return null;
        const now = new Date();
        return {
            wallbox: parsed.resolved,
            thermal: (0, types_1.emptyResolvedThermalIntent)(now, "immersion_heater"),
            battery: (0, types_2.emptyResolvedBatteryIntent)(now, "main"),
            resolvedAll: (0, aggregate_1.buildResolvedAllIntent)(null, { wallbox: parsed.resolved }, now),
            lastRequestIds: {
                wallbox: parsed.last_request_id ?? null,
                thermal: null,
                battery: null,
            },
            wallboxSnapshot: parsed.iobroker_snapshot ?? null,
            thermalSnapshot: null,
            batterySnapshot: null,
        };
    }
    catch {
        return null;
    }
}
