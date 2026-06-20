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
const tibber_parse_1 = require("./tibber_parse");
function slotJson(targetDate, hour, totalEur) {
    const d = new Date(`${targetDate}T${String(hour).padStart(2, "0")}:00:00`);
    return JSON.stringify([{ total: totalEur, startsAt: d.toISOString() }]);
}
function pair(targetDate, hour, forecastCt, actualCt) {
    const hourStartMs = new Date(`${targetDate}T${String(hour).padStart(2, "0")}:00:00`).getTime();
    return {
        targetDate,
        hourStartMs,
        forecastCt,
        actualCt,
        absErrorCt: Math.abs(forecastCt - actualCt),
    };
}
(0, node_test_1.describe)("price forecast learning", () => {
    (0, node_test_1.it)("parses Tibber JSON to hourly ct/kWh slots", () => {
        const target = "2026-06-21";
        const slots = (0, tibber_parse_1.parseTibberPriceJsonToHourlySlots)(slotJson(target, 18, 0.25), target);
        strict_1.default.equal(slots.length, 1);
        strict_1.default.equal(slots[0].forecastCtPerKwh, 25);
    });
    (0, node_test_1.it)("computes absolute error accuracy", () => {
        strict_1.default.equal((0, math_1.accuracyFromAvgErrorCt)(2), 80);
        strict_1.default.equal((0, math_1.accuracyFromAvgErrorCt)(0), 100);
        strict_1.default.equal((0, math_1.accuracyFromAvgErrorCt)(12), 0);
    });
    (0, node_test_1.it)("classifies stability from daily accuracy spread", () => {
        strict_1.default.equal((0, math_1.stabilityFromDailyAccuracy)([90, 91, 89]), "stable");
        strict_1.default.equal((0, math_1.stabilityFromDailyAccuracy)([90, 70, 50]), "volatile");
    });
    (0, node_test_1.it)("aggregates matched pairs into learning result", () => {
        const now = new Date("2026-06-20T20:00:00");
        const pairs = [];
        for (let d = 0; d < 10; d++) {
            const date = `2026-06-${String(20 - d).padStart(2, "0")}`;
            for (let h = 0; h < 8; h++) {
                pairs.push(pair(date, h, 25, 27));
            }
        }
        const result = (0, math_1.computePriceForecastLearning)(pairs, 90, "tibberlink", "tibberlink", now);
        strict_1.default.equal(result.avgErrorCt7d, 2);
        strict_1.default.equal(result.forecastAccuracy7d, 80);
        strict_1.default.ok(result.sampleDays >= 1);
    });
    (0, node_test_1.it)("writes freeze and persist files", async () => {
        const dir = await fs.mkdtemp(path.join(os.tmpdir(), "price-forecast-"));
        await (0, persist_1.writeForecastFreezeFile)(dir, {
            module: "learning.price_forecast.v1",
            frozen_at: "2026-06-20T14:00:00.000Z",
            freeze_date: "2026-06-20",
            target_date: "2026-06-21",
            forecast_source: "tibber",
            slots: [{ hourStartMs: Date.parse("2026-06-21T18:00:00"), forecastCtPerKwh: 25 }],
        });
        const raw = await fs.readFile(path.join(dir, "freeze", "2026-06-21.json"), "utf8");
        strict_1.default.ok(raw.includes("forecastCtPerKwh"));
        const result = (0, math_1.computePriceForecastLearning)([], 90, "tibber", "tibber", new Date());
        await (0, persist_1.writePriceForecastPersist)(dir, result, "2026-06-20T15:00:00.000Z");
        const persist = JSON.parse(await fs.readFile(path.join(dir, "price_forecast_learning_v1.json"), "utf8"));
        strict_1.default.equal(persist.module, "learning.price_forecast.v1");
    });
});
