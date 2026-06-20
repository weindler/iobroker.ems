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
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const fs = __importStar(require("node:fs/promises"));
const os = __importStar(require("node:os"));
const path = __importStar(require("node:path"));
const node_test_1 = require("node:test");
const math_1 = require("./math");
const persist_1 = require("./persist");
function day(overrides) {
    return {
        dateKey: `2026-06-${String(20 - overrides.dayOffset).padStart(2, "0")}`,
        validHours: 20,
        metrics: {
            temp: { bias: 1.2, validHours: 20 },
            cloud: { bias: -8.5, validHours: 20 },
        },
        missingForecast: [],
        missingActual: [],
        confidence: "high",
        health: "ok",
        ...overrides,
    };
}
(0, node_test_1.describe)("weather learning math", () => {
    (0, node_test_1.it)("treats missing as not zero", () => {
        strict_1.default.equal((0, math_1.isValidMetricValue)("temp", null), false);
        strict_1.default.equal((0, math_1.isValidMetricValue)("cloud", Number.NaN), false);
        strict_1.default.equal((0, math_1.isValidMetricValue)("rain", undefined), false);
        strict_1.default.equal((0, math_1.isValidMetricValue)("temp", 0), true);
        strict_1.default.equal((0, math_1.isValidMetricValue)("cloud", 150), false);
    });
    (0, node_test_1.it)("compares only valid forecast/actual pairs via metric bias", () => {
        strict_1.default.equal((0, math_1.metricBias)(22, 20), 2);
        strict_1.default.equal((0, math_1.metricBias)(0, 0), 0);
    });
    (0, node_test_1.it)("maps health to valid hour counts", () => {
        strict_1.default.equal((0, math_1.healthFromValidHours)(21), "ok");
        strict_1.default.equal((0, math_1.healthFromValidHours)(10), "warning");
        strict_1.default.equal((0, math_1.healthFromValidHours)(3), "error");
    });
    (0, node_test_1.it)("maps confidence to valid hour counts", () => {
        strict_1.default.equal((0, math_1.confidenceFromValidHours)(20), "high");
        strict_1.default.equal((0, math_1.confidenceFromValidHours)(14), "medium");
        strict_1.default.equal((0, math_1.confidenceFromValidHours)(8), "low");
        strict_1.default.equal((0, math_1.confidenceFromValidHours)(2), "none");
    });
    (0, node_test_1.it)("aggregates 7d sample days and yesterday summary", () => {
        const days = [0, 1, 2, 3, 4, 5, 6].map((offset) => day({ dayOffset: offset, validHours: 20 }));
        const yesterday = days[1];
        const result = (0, math_1.computeWeatherLearning)(days, { temp: { forecastStateId: "f", actualStateId: "a" }, cloud: { forecastStateId: "f2", actualStateId: "a2" } }, yesterday, "brightsky", "weather_station");
        strict_1.default.equal(result.status, "ready");
        strict_1.default.equal(result.sampleDays7d, 7);
        strict_1.default.equal(result.tempBiasC, 1.2);
        strict_1.default.equal(result.validFields.join(","), "temp,cloud");
        strict_1.default.ok(result.summaryYesterday.includes("Gestern"));
    });
    (0, node_test_1.it)("reports insufficient_data without valid days", () => {
        const days = [day({ dayOffset: 0, validHours: 2, metrics: {} })];
        const result = (0, math_1.computeWeatherLearning)(days, { temp: { forecastStateId: "f", actualStateId: "a" } }, null, "f", "a");
        strict_1.default.equal(result.status, "insufficient_data");
        strict_1.default.equal(result.confidence, "none");
    });
    (0, node_test_1.it)("writes persistence file", async () => {
        const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "ems-weather-"));
        const payload = (0, persist_1.dayResultToPersist)(day({ dayOffset: 1 }), "brightsky", "weather_station");
        await (0, persist_1.writeWeatherDayPersist)(tmp, payload);
        const raw = await fs.readFile(path.join(tmp, `${payload.date}.json`), "utf8");
        const parsed = JSON.parse(raw);
        strict_1.default.equal(parsed.module, "learning.weather.v1");
        strict_1.default.equal(parsed.valid_hours, 20);
        strict_1.default.equal(parsed.metrics.temp_bias_c, 1.2);
        await fs.rm(tmp, { recursive: true, force: true });
    });
});
