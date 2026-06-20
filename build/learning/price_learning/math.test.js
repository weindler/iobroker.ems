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
const history_1 = require("./history");
const math_1 = require("./math");
const persist_1 = require("./persist");
function sample(hourOfDay, dayOffset, priceEur) {
    const d = new Date();
    d.setHours(hourOfDay, 0, 0, 0);
    d.setDate(d.getDate() - dayOffset);
    const ts = d.getTime();
    return {
        ts,
        priceEur,
        hourBucket: ts,
        dateKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        hourOfDay,
    };
}
function daySummary(dayOffset, validHours, avg) {
    const d = new Date();
    d.setDate(d.getDate() - dayOffset);
    return {
        dateKey: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
        dayOffset,
        validHours,
        avgPriceEur: avg,
    };
}
(0, node_test_1.describe)("price learning math", () => {
    (0, node_test_1.it)("treats missing as not zero", () => {
        strict_1.default.equal((0, history_1.isValidPriceValue)(null, "eur_per_kwh"), false);
        strict_1.default.equal((0, history_1.isValidPriceValue)(Number.NaN, "ct_per_kwh"), false);
        strict_1.default.equal((0, history_1.isValidPriceValue)(0, "eur_per_kwh"), true);
        strict_1.default.equal((0, history_1.isValidPriceValue)(0, "ct_per_kwh"), true);
        strict_1.default.equal((0, history_1.isValidPriceValue)(25, "ct_per_kwh"), true);
        strict_1.default.equal((0, history_1.isValidPriceValue)(600, "ct_per_kwh"), false);
    });
    (0, node_test_1.it)("converts ct/kWh to EUR/kWh", () => {
        strict_1.default.equal((0, history_1.toEurPerKwh)(24.5, "ct_per_kwh"), 0.245);
        strict_1.default.equal((0, history_1.toEurPerKwh)(0.245, "eur_per_kwh"), 0.245);
    });
    (0, node_test_1.it)("derives cheap and expensive hours from data", () => {
        const samples = [
            ...Array.from({ length: 5 }, () => sample(2, 1, 0.12)),
            ...Array.from({ length: 5 }, () => sample(3, 1, 0.13)),
            ...Array.from({ length: 5 }, () => sample(18, 1, 0.42)),
            ...Array.from({ length: 5 }, () => sample(19, 1, 0.45)),
        ];
        const patterns = (0, math_1.buildHourPatterns)(samples);
        strict_1.default.ok(Object.keys(patterns.cheapHours).includes("2"));
        strict_1.default.ok(Object.keys(patterns.expensiveHours).includes("19"));
    });
    (0, node_test_1.it)("computes averages volatility and confidence", () => {
        const days = Array.from({ length: 30 }, (_, i) => daySummary(i, 20, 0.2 + (i % 5) * 0.01));
        const samples = days.flatMap((d) => Array.from({ length: 20 }, (_, h) => sample(h, d.dayOffset, d.avgPriceEur ?? 0.2)));
        const result = (0, math_1.computePriceLearning)(samples, days, 30, "ems_live_price");
        strict_1.default.equal(result.status, "ready");
        strict_1.default.ok(result.avgPrice7d !== null);
        strict_1.default.ok(result.avgPrice30d !== null);
        strict_1.default.ok(result.volatility30d !== null);
        strict_1.default.ok(result.confidence >= 50);
        strict_1.default.equal(result.health, "ok");
    });
    (0, node_test_1.it)("reports insufficient_data without valid days", () => {
        const days = [daySummary(0, 2, 0.2)];
        const result = (0, math_1.computePriceLearning)([], days, 90, "ems_live_price");
        strict_1.default.equal(result.status, "insufficient_data");
        strict_1.default.equal(result.sampleDays, 0);
    });
    (0, node_test_1.it)("reduces confidence with high volatility", () => {
        const lowVol = (0, math_1.computeConfidence)({
            sampleDays: 60,
            lookbackDays: 90,
            coveragePct: 90,
            volatility30d: 0.05,
        });
        const highVol = (0, math_1.computeConfidence)({
            sampleDays: 60,
            lookbackDays: 90,
            coveragePct: 90,
            volatility30d: 0.6,
        });
        strict_1.default.ok(lowVol > highVol);
    });
    (0, node_test_1.it)("maps health from sample coverage", () => {
        strict_1.default.equal((0, math_1.healthFromMetrics)(40, 85), "ok");
        strict_1.default.equal((0, math_1.healthFromMetrics)(10, 60), "warning");
        strict_1.default.equal((0, math_1.healthFromMetrics)(2, 10), "error");
    });
    (0, node_test_1.it)("writes persist file", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "price-learning-"));
        const result = (0, math_1.computePriceLearning)([sample(2, 1, 0.2)], [daySummary(1, 20, 0.2)], 90, "ems_live_price");
        await (0, persist_1.writePriceLearningPersist)(dir, result, "2026-06-20T12:00:00.000Z");
        const raw = await fs.readFile(path.join(dir, "price_learning_v1.json"), "utf8");
        const parsed = JSON.parse(raw);
        strict_1.default.equal(parsed.module, "learning.price_learning.v1");
        strict_1.default.ok("health" in parsed);
    });
});
