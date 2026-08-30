"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const slots_js_1 = require("../day_telemetry/slots.js");
const test_helpers_js_1 = require("./test_helpers.js");
const ev_findings_js_1 = require("./ev_findings.js");
function setEvSoc(day, iso, pct) {
    const layout = (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone);
    const idx = (0, slots_js_1.slotIndexForMs)(layout, Date.parse(iso));
    if (idx != null)
        day.buckets.evSocEndPct[idx] = pct;
}
(0, node_test_1.describe)("daily_evaluator ev findings", () => {
    (0, node_test_1.it)("Ziel erreicht → ev_readiness_met, outcomeQuality reasonable", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T10:00:00.000Z",
            wallboxTargetSocPct: 80,
            wallboxDeadlineIso: "2026-06-15T18:00:00.000Z",
        }));
        setEvSoc(day, "2026-06-15T17:45:00.000Z", 85);
        const findings = (0, ev_findings_js_1.evaluateEvFindings)(day);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.ok(findings[0].reasonCodes.includes("ev_readiness_met"));
        strict_1.default.equal(findings[0].quality.outcomeQuality, "reasonable");
    });
    (0, node_test_1.it)("Ziel verfehlt → ev_readiness_missed, outcomeQuality avoidable", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T10:00:00.000Z",
            wallboxTargetSocPct: 80,
            wallboxDeadlineIso: "2026-06-15T18:00:00.000Z",
        }));
        setEvSoc(day, "2026-06-15T17:45:00.000Z", 60);
        const findings = (0, ev_findings_js_1.evaluateEvFindings)(day);
        strict_1.default.ok(findings[0].reasonCodes.includes("ev_readiness_missed"));
        strict_1.default.equal(findings[0].quality.outcomeQuality, "avoidable");
    });
    (0, node_test_1.it)("kein Ist-SOC zur Deadline messbar → insufficientData statt Behauptung", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T10:00:00.000Z",
            wallboxTargetSocPct: 80,
            wallboxDeadlineIso: "2026-06-15T18:00:00.000Z",
        }));
        const findings = (0, ev_findings_js_1.evaluateEvFindings)(day);
        strict_1.default.equal(findings[0].insufficientData, true);
        strict_1.default.equal(findings[0].quality.outcomeQuality, "unknown");
    });
    (0, node_test_1.it)("mehrere Snapshots mit gleicher Deadline: nur der zuletzt bekannte Zielwert zählt (dedupe)", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({ id: "s1", tsIso: "2026-06-15T08:00:00.000Z", wallboxTargetSocPct: 60, wallboxDeadlineIso: "2026-06-15T18:00:00.000Z" }), (0, test_helpers_js_1.makeSnapshot)({ id: "s2", tsIso: "2026-06-15T14:00:00.000Z", wallboxTargetSocPct: 90, wallboxDeadlineIso: "2026-06-15T18:00:00.000Z" }));
        setEvSoc(day, "2026-06-15T17:45:00.000Z", 70);
        const findings = (0, ev_findings_js_1.evaluateEvFindings)(day);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0].measurements.targetSocPct, 90);
        strict_1.default.ok(findings[0].reasonCodes.includes("ev_readiness_missed"));
    });
    (0, node_test_1.it)("Ladung ohne bekanntes Ziel → ev_charging_no_target_known, insufficientData", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const layout = (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone);
        const idx = (0, slots_js_1.slotIndexForMs)(layout, Date.parse("2026-06-15T10:00:00.000Z"));
        if (idx != null)
            day.buckets.evChargedKwh[idx] = 5;
        const findings = (0, ev_findings_js_1.evaluateEvFindings)(day);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0].eventType, "ev_charging_no_target_known");
        strict_1.default.equal(findings[0].insufficientData, true);
    });
    (0, node_test_1.it)("Deadline außerhalb dieses Tages (Cross-Day) → v1 bewusst nicht bewertet", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T22:00:00.000Z",
            wallboxTargetSocPct: 80,
            wallboxDeadlineIso: "2026-06-16T06:00:00.000Z",
        }));
        const findings = (0, ev_findings_js_1.evaluateEvFindings)(day);
        strict_1.default.equal(findings.length, 0);
    });
});
