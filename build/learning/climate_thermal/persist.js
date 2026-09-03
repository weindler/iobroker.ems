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
exports.writeClimateThermalPersist = exports.readClimateThermalPersist = exports.emptyClimateThermalPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const types_1 = require("./types");
function emptyClimateThermalPersist() {
    return { version: 1, generatedAtIso: new Date().toISOString(), units: {} };
}
exports.emptyClimateThermalPersist = emptyClimateThermalPersist;
async function readClimateThermalPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, types_1.CLIMATE_THERMAL_FILENAME), "utf8");
        const parsed = JSON.parse(raw);
        if (parsed?.version === 1 && parsed.units && typeof parsed.units === "object") {
            return parsed;
        }
    }
    catch {
        /* erste Datei */
    }
    return emptyClimateThermalPersist();
}
exports.readClimateThermalPersist = readClimateThermalPersist;
async function writeClimateThermalPersist(baseDir, units) {
    await fs.mkdir(baseDir, { recursive: true });
    const next = {
        version: 1,
        generatedAtIso: new Date().toISOString(),
        units,
    };
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, types_1.CLIMATE_THERMAL_FILENAME), `${JSON.stringify(next, null, 2)}\n`);
    return next;
}
exports.writeClimateThermalPersist = writeClimateThermalPersist;
