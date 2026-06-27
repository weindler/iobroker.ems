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
exports.isLockingFault = exports.normalizePersistMode = exports.isForceExpired = exports.writeRuntimePersist = exports.readRuntimePersist = exports.emptyPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const FILE = "immersion_heater_runtime_v1.json";
function emptyPersist() {
    return {
        resolvedMode: "auto",
        forceTargetTempC: null,
        forceUntil: null,
        lastSwitchAtMs: null,
        lastOffAtMs: null,
        faultLockout: false,
        faultCode: "none",
        faultSince: null,
        commandedStage: 0,
        minRuntimeUntilMs: null,
        pauseUntilMs: null,
    };
}
exports.emptyPersist = emptyPersist;
async function readRuntimePersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, FILE), "utf8");
        const p = JSON.parse(raw);
        return { ...emptyPersist(), ...p };
    }
    catch {
        return null;
    }
}
exports.readRuntimePersist = readRuntimePersist;
async function writeRuntimePersist(baseDir, data) {
    await fs.mkdir(baseDir, { recursive: true });
    await fs.writeFile(path.join(baseDir, FILE), `${JSON.stringify({ module: FILE, ...data }, null, 2)}\n`, "utf8");
}
exports.writeRuntimePersist = writeRuntimePersist;
function isForceExpired(forceUntil, nowMs) {
    if (!forceUntil)
        return false;
    const t = Date.parse(forceUntil);
    return Number.isFinite(t) && nowMs >= t;
}
exports.isForceExpired = isForceExpired;
function normalizePersistMode(mode) {
    if (mode === "off" || mode === "force")
        return mode;
    return "auto";
}
exports.normalizePersistMode = normalizePersistMode;
function isLockingFault(code) {
    return code !== "none" && code !== "temperature_missing" && code !== "temperature_stale" && code !== "temperature_implausible";
}
exports.isLockingFault = isLockingFault;
