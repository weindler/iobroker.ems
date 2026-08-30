"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const slots_js_1 = require("../day_telemetry/slots.js");
const test_helpers_js_1 = require("./test_helpers.js");
const thermal_findings_js_1 = require("./thermal_findings.js");
function priceAtHour(hour) {
    return 10 + hour * 1.5;
}
function cheapExpensivePriceSeries(day) {
    const layout = (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone);
    for (const slot of layout.slots) {
        const hour = new Date(slot.startMs).getUTCHours();
        day.buckets.priceCtPerKwh[slot.index] = priceAtHour(hour);
    }
}
(0, node_test_1.describe)("daily_evaluator thermal findings", () => {
    (0, node_test_1.it)("Hygiene fällig → mandatory, unabhängig vom Preis", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        cheapExpensivePriceSeries(day);
        day.immersionRunSegments.push({
            startTs: Date.parse("2026-06-15T14:00:00.000Z"),
            endTs: Date.parse("2026-06-15T14:30:00.000Z"),
            energyKwh: 1.2,
            runtimeSec: 1800,
            valid: true,
            rejectReason: null,
            decisionSource: "daily_plan",
            forcedMode: false,
            hygieneStatusDe: "Hygiene fällig — Boiler auf >60 °C bringen.",
            ownershipOwner: "ems",
        });
        const findings = (0, thermal_findings_js_1.evaluateThermalFindings)(day);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0].quality.decisionQuality, "mandatory");
        strict_1.default.equal(findings[0].quality.outcomeQuality, "mandatory");
        strict_1.default.equal(findings[0].insufficientData, false);
    });
    (0, node_test_1.it)("thermal_fallback → necessary", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.immersionRunSegments.push({
            startTs: Date.parse("2026-06-15T03:00:00.000Z"),
            endTs: Date.parse("2026-06-15T03:15:00.000Z"),
            energyKwh: 0.5,
            runtimeSec: 900,
            valid: true,
            rejectReason: null,
            decisionSource: "thermal_fallback",
            forcedMode: false,
            hygieneStatusDe: null,
            ownershipOwner: null,
        });
        const findings = (0, thermal_findings_js_1.evaluateThermalFindings)(day);
        strict_1.default.equal(findings[0].quality.decisionQuality, "necessary");
    });
    (0, node_test_1.it)("daily_plan im günstigen Preisfenster → reasonable (decision + outcome)", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        cheapExpensivePriceSeries(day);
        const snap = (0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T00:00:00.000Z",
            priceSlots: (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone).slots.map((s) => [
                s.startMs,
                priceAtHour(new Date(s.startMs).getUTCHours()),
            ]),
        });
        day.forecastSnapshots.push(snap);
        day.immersionRunSegments.push({
            startTs: Date.parse("2026-06-15T02:00:00.000Z"),
            endTs: Date.parse("2026-06-15T02:30:00.000Z"),
            energyKwh: 1.0,
            runtimeSec: 1800,
            valid: true,
            rejectReason: null,
            decisionSource: "daily_plan",
            forcedMode: false,
            hygieneStatusDe: "Hygiene innerhalb 7 Tage erfüllt.",
            ownershipOwner: "ems",
        });
        const findings = (0, thermal_findings_js_1.evaluateThermalFindings)(day);
        strict_1.default.equal(findings[0].quality.decisionQuality, "reasonable");
        strict_1.default.equal(findings[0].quality.outcomeQuality, "reasonable");
        strict_1.default.ok(findings[0].reasonCodes.includes("daily_plan_price_timed"));
    });
    (0, node_test_1.it)("daily_plan im teuersten Preisfenster → wasteful", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        cheapExpensivePriceSeries(day);
        const snap = (0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-14T22:00:00.000Z",
            priceSlots: (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone).slots.map((s) => [
                s.startMs,
                priceAtHour(new Date(s.startMs).getUTCHours()),
            ]),
        });
        day.forecastSnapshots.push(snap);
        day.immersionRunSegments.push({
            startTs: Date.parse("2026-06-14T23:00:00.000Z"),
            endTs: Date.parse("2026-06-14T23:30:00.000Z"),
            energyKwh: 1.0,
            runtimeSec: 1800,
            valid: true,
            rejectReason: null,
            decisionSource: "daily_plan",
            forcedMode: false,
            hygieneStatusDe: null,
            ownershipOwner: "ems",
        });
        const findings = (0, thermal_findings_js_1.evaluateThermalFindings)(day);
        strict_1.default.equal(findings[0].quality.decisionQuality, "wasteful");
    });
    (0, node_test_1.it)("decisionSource unbekannt (ältere/fehlende Daten) → unknown, insufficientData=true", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.immersionRunSegments.push({
            startTs: Date.parse("2026-06-15T10:00:00.000Z"),
            endTs: Date.parse("2026-06-15T10:15:00.000Z"),
            energyKwh: 0.3,
            runtimeSec: 900,
            valid: true,
            rejectReason: null,
            decisionSource: null,
            forcedMode: null,
            hygieneStatusDe: null,
            ownershipOwner: null,
        });
        const findings = (0, thermal_findings_js_1.evaluateThermalFindings)(day);
        strict_1.default.equal(findings[0].quality.decisionQuality, "unknown");
        strict_1.default.equal(findings[0].insufficientData, true);
    });
    (0, node_test_1.it)("forcedMode=true wird als reasonCode + userOverride markiert", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.immersionRunSegments.push({
            startTs: Date.parse("2026-06-15T10:00:00.000Z"),
            endTs: Date.parse("2026-06-15T10:15:00.000Z"),
            energyKwh: 0.3,
            runtimeSec: 900,
            valid: true,
            rejectReason: null,
            decisionSource: "daily_plan",
            forcedMode: true,
            hygieneStatusDe: null,
            ownershipOwner: null,
        });
        const findings = (0, thermal_findings_js_1.evaluateThermalFindings)(day);
        strict_1.default.equal(findings[0].userOverride, true);
        strict_1.default.ok(findings[0].reasonCodes.includes("forced_mode_active"));
    });
    (0, node_test_1.it)("Segment mit 0 Laufzeit wird ignoriert", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.immersionRunSegments.push({
            startTs: 1000,
            endTs: 1000,
            energyKwh: 0,
            runtimeSec: 0,
            valid: true,
            rejectReason: null,
            decisionSource: "daily_plan",
            forcedMode: false,
            hygieneStatusDe: null,
            ownershipOwner: null,
        });
        strict_1.default.equal((0, thermal_findings_js_1.evaluateThermalFindings)(day).length, 0);
    });
});
