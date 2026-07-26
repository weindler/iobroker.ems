"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const thermal_learning_1 = require("./thermal_learning");
const NOW = new Date("2026-07-26T10:00:00.000Z"); // Sonntag → weekend
(0, node_test_1.describe)("thermal learning signal", () => {
    (0, node_test_1.it)("returns missing without a learning model (no source)", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "no_source",
            rawHealth: "no_source",
            samples: 0,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            estimatedRemainingHours: null,
            estimatedEmptyAtRaw: null,
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.status, "missing");
        strict_1.default.equal(signal.coolingRateCPerHAvg, null);
        strict_1.default.equal(signal.estimatedEmptyAt, null);
    });
    (0, node_test_1.it)("returns missing when disabled in admin", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "disabled",
            rawHealth: "no_source",
            samples: 0,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            estimatedRemainingHours: null,
            estimatedEmptyAtRaw: null,
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.status, "missing");
    });
    (0, node_test_1.it)("returns degraded with few cycles (insufficient_data)", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "insufficient_data",
            rawHealth: "degraded",
            samples: 2,
            coolingRateCPerHAvg: 1.2,
            coolingConstantPerH: null,
            coolingAsymptoteC: null,
            estimatedRemainingHours: 5,
            estimatedEmptyAtRaw: "2026-07-26T15:00:00.000Z",
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.status, "degraded");
        strict_1.default.equal(signal.coolingRateCPerHAvg, 1.2);
    });
    (0, node_test_1.it)("returns valid with a healthy model and future estimated_empty_at", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 12,
            coolingRateCPerHAvg: 0.9,
            coolingConstantPerH: 0.05,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 6.5,
            estimatedEmptyAtRaw: "2026-07-26T16:30:00.000Z",
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.status, "valid");
        strict_1.default.equal(signal.coolingRateCPerHAvg, 0.9);
        strict_1.default.equal(signal.estimatedEmptyAt, "2026-07-26T16:30:00.000Z");
    });
    (0, node_test_1.it)("drops estimated_empty_at when it lies in the past (stale data)", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 12,
            coolingRateCPerHAvg: 0.9,
            coolingConstantPerH: 0.05,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 0,
            estimatedEmptyAtRaw: "2026-07-25T08:00:00.000Z",
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.status, "valid");
        strict_1.default.equal(signal.estimatedEmptyAt, null);
    });
    (0, node_test_1.it)("extracts the current day-type median runtime from by_day_type_json", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW, // Sunday → weekend
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 12,
            coolingRateCPerHAvg: 0.9,
            coolingConstantPerH: 0.05,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 6,
            estimatedEmptyAtRaw: null,
            byDayTypeJsonRaw: JSON.stringify({
                weekday: { samples: 8, runtime_hours_median: 10 },
                weekend: { samples: 4, runtime_hours_median: 14 },
            }),
        });
        strict_1.default.equal(signal.currentDayTypeRuntimeHoursMedian, 14);
    });
    (0, node_test_1.it)("never fabricates a value when the JSON is malformed", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 12,
            coolingRateCPerHAvg: 0.9,
            coolingConstantPerH: 0.05,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 6,
            estimatedEmptyAtRaw: null,
            byDayTypeJsonRaw: "not-json",
        });
        strict_1.default.equal(signal.currentDayTypeRuntimeHoursMedian, null);
    });
});
