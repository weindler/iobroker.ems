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
exports.normalizeVehiclePresenceStore = normalizeVehiclePresenceStore;
exports.readVehiclePresencePersist = readVehiclePresencePersist;
exports.writeVehiclePresencePersist = writeVehiclePresencePersist;
exports.loadOrEmptyVehiclePresenceStore = loadOrEmptyVehiclePresenceStore;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const constants_1 = require("./constants");
const types_1 = require("./types");
/**
 * v1 flat buckets (Tick-Inflation möglich) werden verworfen — kein Trust in alte Counts.
 * Nur schemaVersion 2 mit profiles wird geladen.
 */
function normalizeVehiclePresenceStore(raw) {
    if (!raw || typeof raw !== "object")
        return null;
    const o = raw;
    if (o.module !== constants_1.MODULE_TAG)
        return null;
    if (o.schemaVersion === 2 && o.profiles && typeof o.profiles === "object") {
        return {
            module: constants_1.MODULE_TAG,
            schemaVersion: 2,
            updatedAtIso: typeof o.updatedAtIso === "string" ? o.updatedAtIso : new Date().toISOString(),
            profiles: o.profiles,
        };
    }
    return null;
}
async function readVehiclePresencePersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, constants_1.PERSIST_FILE), "utf8");
        return normalizeVehiclePresenceStore(JSON.parse(raw));
    }
    catch {
        return null;
    }
}
async function writeVehiclePresencePersist(baseDir, store) {
    await fs.mkdir(baseDir, { recursive: true });
    const payload = {
        ...store,
        module: constants_1.MODULE_TAG,
        schemaVersion: 2,
    };
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, constants_1.PERSIST_FILE), `${JSON.stringify(payload, null, 2)}\n`);
}
async function loadOrEmptyVehiclePresenceStore(baseDir) {
    if (!baseDir)
        return (0, types_1.emptyVehiclePresenceStore)();
    return (await readVehiclePresencePersist(baseDir)) ?? (0, types_1.emptyVehiclePresenceStore)();
}
