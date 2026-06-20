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
exports.dayResultToPersist = exports.writeWeatherDayPersist = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
async function writeWeatherDayPersist(baseDir, payload) {
    await fs.mkdir(baseDir, { recursive: true });
    const filePath = path.join(baseDir, `${payload.date}.json`);
    await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}
exports.writeWeatherDayPersist = writeWeatherDayPersist;
function dayResultToPersist(day, forecastSource, actualSource) {
    return {
        date: day.dateKey,
        module: "learning.weather.v1",
        forecast_source: forecastSource,
        actual_source: actualSource,
        valid_hours: day.validHours,
        metrics: {
            temp_bias_c: day.metrics.temp?.bias ?? null,
            cloud_bias_pct: day.metrics.cloud?.bias ?? null,
            rain_bias_mm: day.metrics.rain?.bias ?? null,
            wind_bias_ms: day.metrics.wind?.bias ?? null,
        },
        missing: {
            forecast: day.missingForecast,
            actual: day.missingActual,
        },
        confidence: day.confidence,
        health: day.health,
    };
}
exports.dayResultToPersist = dayResultToPersist;
