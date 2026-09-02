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
exports.coldStartPersist = exports.readGridBalanceEconomicsPersist = exports.writeGridBalanceEconomicsPersist = exports.gridBalanceEconomicsDirFromHost = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
const constants_1 = require("./constants");
const types_1 = require("./types");
function gridBalanceEconomicsDirFromHost(getAbsolutePath) {
    if (!getAbsolutePath)
        return undefined;
    return getAbsolutePath(constants_1.GRID_BALANCE_ECONOMICS_CATEGORY);
}
exports.gridBalanceEconomicsDirFromHost = gridBalanceEconomicsDirFromHost;
async function writeGridBalanceEconomicsPersist(baseDir, payload) {
    await fs.mkdir(baseDir, { recursive: true });
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, constants_1.GRID_BALANCE_ECONOMICS_FILE), `${JSON.stringify(payload, null, 2)}\n`);
}
exports.writeGridBalanceEconomicsPersist = writeGridBalanceEconomicsPersist;
async function readGridBalanceEconomicsPersist(baseDir) {
    if (!baseDir)
        return null;
    try {
        const raw = await fs.readFile(path.join(baseDir, constants_1.GRID_BALANCE_ECONOMICS_FILE), "utf8");
        const parsed = JSON.parse(raw);
        if (!parsed || parsed.module !== constants_1.GRID_BALANCE_ECONOMICS_MODULE)
            return null;
        if (parsed.schemaVersion !== constants_1.GRID_BALANCE_ECONOMICS_SCHEMA)
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.readGridBalanceEconomicsPersist = readGridBalanceEconomicsPersist;
function coldStartPersist(generatedAt) {
    return (0, types_1.emptyEconomicsPersist)(generatedAt, "Cold Start — noch keine belastbaren Economics-Daten (30-ct-Fallback).");
}
exports.coldStartPersist = coldStartPersist;
