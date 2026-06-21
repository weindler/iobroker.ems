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
exports.readHouseLoadPersist = exports.writeHouseLoadPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const constants_1 = require("./constants");
async function writeHouseLoadPersist(baseDir, result, lastRun) {
    await fs.mkdir(baseDir, { recursive: true });
    const payload = {
        generated_at: lastRun,
        module: constants_1.MODULE_TAG,
        sample_count: result.sampleCount,
        sample_days: result.sampleDays,
        confidence: result.confidence,
        profile: result.profileJson,
        forecast_today: result.forecastTodayJson,
        forecast_tomorrow: result.forecastTomorrowJson,
        health: { ...result.healthJson, last_persist_at: lastRun },
    };
    await fs.writeFile(path.join(baseDir, "house_load_learning_v1.json"), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
exports.writeHouseLoadPersist = writeHouseLoadPersist;
async function readHouseLoadPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, "house_load_learning_v1.json"), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
exports.readHouseLoadPersist = readHouseLoadPersist;
