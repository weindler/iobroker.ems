"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const slots_js_1 = require("../day_telemetry/slots.js");
const test_helpers_js_1 = require("./test_helpers.js");
const climate_findings_js_1 = require("./climate_findings.js");
function priceAtHour(hour) {
    return 10 + hour * 1.5;
}
function rampPriceSeries(day) {
    const layout = (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone);
    for (const slot of layout.slots) {
        day.buckets.priceCtPerKwh[slot.index] = priceAtHour(new Date(slot.startMs).getUTCHours());
    }
}
function priceSnapshot(day, overrides = {}) {
    return (0, test_helpers_js_1.makeSnapshot)({
        tsIso: "2026-06-15T00:00:00.000Z",
        priceSlots: (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone).slots.map((s) => [
            s.startMs,
            priceAtHour(new Date(s.startMs).getUTCHours()),
        ]),
        ...overrides,
    });
}
(0, node_test_1.describe)("daily_evaluator climate findings", () => {
    (0, node_test_1.it)("mandatory=true im Snapshot → mandatory Klassifikation", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        rampPriceSeries(day);
        day.forecastSnapshots.push(priceSnapshot(day, {
            climateUnits: [{ consumerId: "u1", sharedPowerGroupId: "outdoor_1", mandatory: true, mode: "cool" }],
        }));
        day.climateRunSegments.push({
            startTs: Date.parse("2026-06-15T23:00:00.000Z"),
            endTs: Date.parse("2026-06-15T23:30:00.000Z"),
            sharedPowerGroupId: "outdoor_1",
            mode: "cool",
            activeUnitCombination: "1",
            energyKwh: 0.8,
            runtimeSec: 1800,
            valid: true,
            rejectReason: null,
        });
        const findings = (0, climate_findings_js_1.evaluateClimateFindings)(day);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0].quality.decisionQuality, "mandatory");
    });
    (0, node_test_1.it)("nicht mandatory, günstiges Preisfenster → reasonable", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        rampPriceSeries(day);
        day.forecastSnapshots.push(priceSnapshot(day, {
            climateUnits: [{ consumerId: "u1", sharedPowerGroupId: "outdoor_1", mandatory: false, mode: "cool" }],
        }));
        day.climateRunSegments.push({
            startTs: Date.parse("2026-06-15T02:00:00.000Z"),
            endTs: Date.parse("2026-06-15T02:30:00.000Z"),
            sharedPowerGroupId: "outdoor_1",
            mode: "cool",
            activeUnitCombination: "1",
            energyKwh: 0.5,
            runtimeSec: 1800,
            valid: true,
            rejectReason: null,
        });
        const findings = (0, climate_findings_js_1.evaluateClimateFindings)(day);
        strict_1.default.equal(findings[0].quality.decisionQuality, "reasonable");
    });
    (0, node_test_1.it)("kein Snapshot vorhanden → unknown + insufficientData (keine Rekonstruktion)", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        rampPriceSeries(day);
        day.climateRunSegments.push({
            startTs: Date.parse("2026-06-15T10:00:00.000Z"),
            endTs: Date.parse("2026-06-15T10:30:00.000Z"),
            sharedPowerGroupId: "outdoor_1",
            mode: "cool",
            activeUnitCombination: "1",
            energyKwh: 0.4,
            runtimeSec: 1800,
            valid: true,
            rejectReason: null,
        });
        const findings = (0, climate_findings_js_1.evaluateClimateFindings)(day);
        strict_1.default.equal(findings[0].quality.decisionQuality, "unknown");
        strict_1.default.equal(findings[0].insufficientData, true);
    });
    (0, node_test_1.it)("ungültiges Segment → unknown, kein erfundener Energie-/Preisbezug", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.climateRunSegments.push({
            startTs: Date.parse("2026-06-15T10:00:00.000Z"),
            endTs: Date.parse("2026-06-15T10:30:00.000Z"),
            sharedPowerGroupId: null,
            mode: "cool",
            activeUnitCombination: "1",
            energyKwh: 0.4,
            runtimeSec: 1800,
            valid: false,
            rejectReason: "shared_power_group_unknown",
        });
        const findings = (0, climate_findings_js_1.evaluateClimateFindings)(day);
        strict_1.default.equal(findings[0].quality.decisionQuality, "unknown");
        strict_1.default.equal(findings[0].insufficientData, true);
        strict_1.default.ok(findings[0].reasonCodes.includes("shared_power_group_unknown"));
    });
});
