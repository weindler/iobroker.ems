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
        strict_1.default.equal(signal.estimatedRemainingHours, 6.5);
        // UTC 16:30 → CEST 18:30 — reasonDe darf keine UTC-Ziffern als Ortszeit zeigen.
        strict_1.default.match(signal.reasonDe, /18:30/);
        strict_1.default.doesNotMatch(signal.reasonDe, /16:30/);
    });
    (0, node_test_1.it)("degrades Newton-only ready+ok with zero cycles (not cycle-valid; empty_at kept)", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 0,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.09,
            coolingAsymptoteC: 40,
            estimatedRemainingHours: 3,
            estimatedEmptyAtRaw: "2026-07-26T13:00:00.000Z",
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.status, "degraded");
        strict_1.default.equal(signal.estimatedEmptyAt, "2026-07-26T13:00:00.000Z");
        strict_1.default.match(signal.reasonDe, /Newton|0 abgeschlossene/);
    });
    (0, node_test_1.it)("derives live remaining from empty_at when stored remaining is stale", () => {
        const later = new Date("2026-07-26T14:00:00.000Z"); // 2.5 h before empty_at
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: later,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 12,
            coolingRateCPerHAvg: 0.9,
            coolingConstantPerH: 0.05,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 6.5, // eingefrorener Snapshot vom früheren Lauf
            estimatedEmptyAtRaw: "2026-07-26T16:30:00.000Z",
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.estimatedEmptyAt, "2026-07-26T16:30:00.000Z");
        strict_1.default.equal(signal.estimatedRemainingHours, 2.5);
    });
    (0, node_test_1.it)("drops estimated_empty_at when it is truly stale (>12h overdue, no fresh learning run)", () => {
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: NOW,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 12,
            coolingRateCPerHAvg: 0.9,
            coolingConstantPerH: 0.05,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 0,
            estimatedEmptyAtRaw: "2026-07-25T08:00:00.000Z", // ~26h vor NOW
            byDayTypeJsonRaw: null,
        });
        strict_1.default.equal(signal.status, "valid");
        strict_1.default.equal(signal.estimatedEmptyAt, null);
        strict_1.default.equal(signal.estimatedRemainingHours, 0);
    });
    (0, node_test_1.it)("keeps a recently overdue estimated_empty_at as acute (Boiler jetzt am Minimum) — not discarded", () => {
        /*
         * Kernfall (One-Plan): Boiler erreicht laut frischem Learning gerade jetzt das
         * Minimum. Vorher wurde das als "veraltet" verworfen → Planner sah keinen
         * Pflichtbedarf, obwohl der Boiler exakt am Minimum steht. Überfällig um wenige
         * Minuten ist akut, nicht stale.
         */
        const overdueBy5Min = new Date(NOW.getTime() + 5 * 60_000);
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: overdueBy5Min,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 0,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.00477,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 0,
            estimatedEmptyAtRaw: NOW.toISOString(),
            byDayTypeJsonRaw: null,
            vessel: "boiler",
        });
        strict_1.default.equal(signal.status, "degraded");
        strict_1.default.equal(signal.estimatedEmptyAt, NOW.toISOString());
        strict_1.default.equal(signal.estimatedRemainingHours, 0);
        strict_1.default.match(signal.reasonDe, /bereits erreicht/);
    });
    (0, node_test_1.it)("still drops a Newton estimate overdue by more than 12h (stale, not acute)", () => {
        const overdueBy20h = new Date(NOW.getTime() + 20 * 3_600_000);
        const signal = (0, thermal_learning_1.buildThermalLearningSignal)({
            now: overdueBy20h,
            rawStatus: "ready",
            rawHealth: "ok",
            samples: 0,
            coolingRateCPerHAvg: null,
            coolingConstantPerH: 0.00477,
            coolingAsymptoteC: 18,
            estimatedRemainingHours: 0,
            estimatedEmptyAtRaw: NOW.toISOString(),
            byDayTypeJsonRaw: null,
            vessel: "boiler",
        });
        strict_1.default.equal(signal.estimatedEmptyAt, null);
        strict_1.default.equal(signal.estimatedRemainingHours, 0);
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
