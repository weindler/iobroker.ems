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
exports.writeHouseLoadPersist = writeHouseLoadPersist;
exports.readHouseLoadPersist = readHouseLoadPersist;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const atomic_write_1 = require("../../persistence/atomic_write");
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
        forecast_horizon: result.forecastHorizonJson,
        health: { ...result.healthJson, last_persist_at: lastRun },
    };
    await (0, atomic_write_1.atomicWriteFile)(path.join(baseDir, "house_load_learning_v1.json"), `${JSON.stringify(payload, null, 2)}\n`);
}
async function readHouseLoadPersist(baseDir) {
    try {
        const raw = await fs.readFile(path.join(baseDir, "house_load_learning_v1.json"), "utf8");
        return JSON.parse(raw);
    }
    catch {
        return null;
    }
}
