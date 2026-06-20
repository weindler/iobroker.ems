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
exports.writePriceForecastPersist = exports.readForecastFreezeFiles = exports.writeForecastFreezeFile = exports.freezeFilePath = exports.freezeDir = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("./constants");
function freezeDir(baseDir) {
    return path.join(baseDir, "freeze");
}
exports.freezeDir = freezeDir;
function freezeFilePath(baseDir, targetDate) {
    return path.join(freezeDir(baseDir), `${targetDate}.json`);
}
exports.freezeFilePath = freezeFilePath;
async function writeForecastFreezeFile(baseDir, payload) {
    const dir = freezeDir(baseDir);
    await fs.mkdir(dir, { recursive: true });
    const filePath = freezeFilePath(baseDir, payload.target_date);
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
exports.writeForecastFreezeFile = writeForecastFreezeFile;
async function readForecastFreezeFiles(baseDir, lookbackDays) {
    const dir = freezeDir(baseDir);
    let names = [];
    try {
        names = await fs.readdir(dir);
    }
    catch {
        return [];
    }
    const cutoff = new Date();
    cutoff.setHours(0, 0, 0, 0);
    cutoff.setDate(cutoff.getDate() - lookbackDays);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const files = [];
    for (const name of names) {
        if (!name.endsWith(".json"))
            continue;
        const targetDate = name.replace(/\.json$/, "");
        if (targetDate < cutoffKey)
            continue;
        try {
            const raw = await fs.readFile(path.join(dir, name), "utf8");
            const parsed = JSON.parse(raw);
            if (parsed?.target_date && Array.isArray(parsed.slots)) {
                files.push(parsed);
            }
        }
        catch {
            // skip corrupt file
        }
    }
    return files;
}
exports.readForecastFreezeFiles = readForecastFreezeFiles;
async function writePriceForecastPersist(baseDir, result, lastRun) {
    await fs.mkdir(baseDir, { recursive: true });
    const payload = {
        generated_at: lastRun,
        module: constants_1.MODULE_TAG,
        sample_days: result.sampleDays,
        coverage_pct: result.coveragePct,
        missing_days: result.missingDays,
        forecast_accuracy_7d: result.forecastAccuracy7d,
        forecast_accuracy_30d: result.forecastAccuracy30d,
        forecast_accuracy_90d: result.forecastAccuracy90d,
        avg_error_ct_7d: result.avgErrorCt7d,
        avg_error_ct_30d: result.avgErrorCt30d,
        avg_error_ct_90d: result.avgErrorCt90d,
        forecast_confidence: result.forecastConfidence,
        stability: result.stability,
        health: {
            status: result.health,
            sample_days: result.sampleDays,
            coverage_pct: result.coveragePct,
            missing_days: result.missingDays,
            last_run: lastRun,
            forecast_confidence: result.forecastConfidence,
        },
    };
    await fs.writeFile(path.join(baseDir, "price_forecast_learning_v1.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
exports.writePriceForecastPersist = writePriceForecastPersist;
