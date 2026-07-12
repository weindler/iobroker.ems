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
exports.writeDailyPlanFile = exports.readDailyPlanFile = exports.writeForecastPlanFile = exports.readForecastPlanFile = exports.dailyPlanFilePath = exports.forecastPlanFilePath = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const paths_1 = require("../backup_integration/paths");
const atomic_write_1 = require("../persistence/atomic_write");
function plannerDir(host) {
    return path.join((0, paths_1.resolveEmsPaths)(host).durableDataDir, "planner");
}
function forecastPlanFilePath(host) {
    return path.join(plannerDir(host), "forecast_plan.json");
}
exports.forecastPlanFilePath = forecastPlanFilePath;
function dailyPlanFilePath(host) {
    return path.join(plannerDir(host), "daily_plan.json");
}
exports.dailyPlanFilePath = dailyPlanFilePath;
async function readForecastPlanFile(host) {
    try {
        const raw = await fs.readFile(forecastPlanFilePath(host), "utf8");
        return raw.trim() ? raw : null;
    }
    catch {
        return null;
    }
}
exports.readForecastPlanFile = readForecastPlanFile;
async function writeForecastPlanFile(host, planJson) {
    await (0, atomic_write_1.atomicWriteFile)(forecastPlanFilePath(host), planJson);
}
exports.writeForecastPlanFile = writeForecastPlanFile;
async function readDailyPlanFile(host) {
    try {
        const raw = await fs.readFile(dailyPlanFilePath(host), "utf8");
        return raw.trim() ? raw : null;
    }
    catch {
        return null;
    }
}
exports.readDailyPlanFile = readDailyPlanFile;
async function writeDailyPlanFile(host, planJson) {
    await (0, atomic_write_1.atomicWriteFile)(dailyPlanFilePath(host), planJson);
}
exports.writeDailyPlanFile = writeDailyPlanFile;
