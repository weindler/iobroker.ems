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
exports.writePlannerIntentFile = exports.readPlannerIntentFile = exports.writeFlexibleContributionsFile = exports.readFlexibleContributionsFile = exports.writeGridSupplySlotsFile = exports.readGridSupplySlotsFile = exports.writeDailyPlanFile = exports.readDailyPlanFile = exports.writeForecastPlanFile = exports.readForecastPlanFile = exports.plannerIntentFilePath = exports.flexibleContributionsFilePath = exports.gridSupplySlotsFilePath = exports.dailyPlanFilePath = exports.forecastPlanFilePath = void 0;
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
function gridSupplySlotsFilePath(host) {
    return path.join(plannerDir(host), "grid_supply_slots.json");
}
exports.gridSupplySlotsFilePath = gridSupplySlotsFilePath;
function flexibleContributionsFilePath(host) {
    return path.join(plannerDir(host), "flexible_contributions.json");
}
exports.flexibleContributionsFilePath = flexibleContributionsFilePath;
function plannerIntentFilePath(host) {
    return path.join(plannerDir(host), "planner_intent_last.json");
}
exports.plannerIntentFilePath = plannerIntentFilePath;
async function readPlannerFile(host, filePath) {
    try {
        const raw = await fs.readFile(filePath, "utf8");
        return raw.trim() ? raw : null;
    }
    catch {
        return null;
    }
}
async function writePlannerFile(host, filePath, content) {
    try {
        await (0, atomic_write_1.atomicWriteFile)(filePath, content);
    }
    catch (e) {
        throw e;
    }
}
function safePlannerPath(host, build) {
    try {
        return build(host);
    }
    catch {
        return null;
    }
}
async function readForecastPlanFile(host) {
    const filePath = safePlannerPath(host, forecastPlanFilePath);
    if (!filePath)
        return null;
    return readPlannerFile(host, filePath);
}
exports.readForecastPlanFile = readForecastPlanFile;
async function writeForecastPlanFile(host, planJson) {
    const filePath = safePlannerPath(host, forecastPlanFilePath);
    if (!filePath)
        throw new Error("forecast plan file path unavailable");
    await writePlannerFile(host, filePath, planJson);
}
exports.writeForecastPlanFile = writeForecastPlanFile;
async function readDailyPlanFile(host) {
    const filePath = safePlannerPath(host, dailyPlanFilePath);
    if (!filePath)
        return null;
    return readPlannerFile(host, filePath);
}
exports.readDailyPlanFile = readDailyPlanFile;
async function writeDailyPlanFile(host, planJson) {
    const filePath = safePlannerPath(host, dailyPlanFilePath);
    if (!filePath)
        throw new Error("daily plan file path unavailable");
    await writePlannerFile(host, filePath, planJson);
}
exports.writeDailyPlanFile = writeDailyPlanFile;
async function readGridSupplySlotsFile(host) {
    const filePath = safePlannerPath(host, gridSupplySlotsFilePath);
    if (!filePath)
        return null;
    return readPlannerFile(host, filePath);
}
exports.readGridSupplySlotsFile = readGridSupplySlotsFile;
async function writeGridSupplySlotsFile(host, slotsJson) {
    const filePath = safePlannerPath(host, gridSupplySlotsFilePath);
    if (!filePath)
        throw new Error("grid supply slots file path unavailable");
    await writePlannerFile(host, filePath, slotsJson);
}
exports.writeGridSupplySlotsFile = writeGridSupplySlotsFile;
async function readFlexibleContributionsFile(host) {
    const filePath = safePlannerPath(host, flexibleContributionsFilePath);
    if (!filePath)
        return null;
    return readPlannerFile(host, filePath);
}
exports.readFlexibleContributionsFile = readFlexibleContributionsFile;
async function writeFlexibleContributionsFile(host, payloadJson) {
    const filePath = safePlannerPath(host, flexibleContributionsFilePath);
    if (!filePath)
        throw new Error("flexible contributions file path unavailable");
    await writePlannerFile(host, filePath, payloadJson);
}
exports.writeFlexibleContributionsFile = writeFlexibleContributionsFile;
async function readPlannerIntentFile(host) {
    const filePath = safePlannerPath(host, plannerIntentFilePath);
    if (!filePath)
        return null;
    return readPlannerFile(host, filePath);
}
exports.readPlannerIntentFile = readPlannerIntentFile;
async function writePlannerIntentFile(host, intentJson) {
    const filePath = safePlannerPath(host, plannerIntentFilePath);
    if (!filePath)
        throw new Error("planner intent file path unavailable");
    await writePlannerFile(host, filePath, intentJson);
}
exports.writePlannerIntentFile = writePlannerIntentFile;
