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
exports.writeClimateSharedPowerPersist = exports.readClimateSharedPowerPersist = exports.emptyClimateSharedPowerPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const types_1 = require("./types");
function emptyClimateSharedPowerPersist() {
    return { version: 1, generatedAtIso: new Date().toISOString(), stats: {} };
}
exports.emptyClimateSharedPowerPersist = emptyClimateSharedPowerPersist;
async function readClimateSharedPowerPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, types_1.CLIMATE_SHARED_POWER_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.stats && typeof parsed.stats === "object") {
            return parsed;
        }
    }
    catch {
        // neue Datei beim ersten Schreiben
    }
    return emptyClimateSharedPowerPersist();
}
exports.readClimateSharedPowerPersist = readClimateSharedPowerPersist;
async function writeClimateSharedPowerPersist(baseDir, stats) {
    await fs.mkdir(baseDir, { recursive: true });
    const next = {
        version: 1,
        generatedAtIso: new Date().toISOString(),
        stats,
    };
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, types_1.CLIMATE_SHARED_POWER_FILENAME), `${JSON.stringify(next, null, 2)}\n`);
    return next;
}
exports.writeClimateSharedPowerPersist = writeClimateSharedPowerPersist;
