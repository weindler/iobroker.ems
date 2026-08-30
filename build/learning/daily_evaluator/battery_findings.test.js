"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const slots_js_1 = require("../day_telemetry/slots.js");
const test_helpers_js_1 = require("./test_helpers.js");
const battery_findings_js_1 = require("./battery_findings.js");
const SLOT_MS = 15 * 60_000;
/** Füllt lückenlos alle 15-Minuten-Slots im Fenster [fromIso, toIso) mit pct, damit die
 * Coverage-Schwelle für belastbare Findings erreicht wird (statt nur Stundenmarken). */
function fillSocRange(day, fromIso, toIso, pct) {
    const layout = (0, slots_js_1.buildDaySlotLayout)(day.dateKey, day.timezone);
    for (let ms = Date.parse(fromIso); ms < Date.parse(toIso); ms += SLOT_MS) {
        const idx = (0, slots_js_1.slotIndexForMs)(layout, ms);
        if (idx != null)
            day.buckets.batterySocEndPct[idx] = pct;
    }
}
(0, node_test_1.describe)("daily_evaluator battery findings", () => {
    (0, node_test_1.it)("kein Snapshot mit batteryDecision → keine Findings", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const findings = (0, battery_findings_js_1.evaluateBatteryFindings)(day, null);
        strict_1.default.equal(findings.length, 0);
    });
    (0, node_test_1.it)("Reserve gehalten → reserve_held, outcomeQuality reasonable", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T18:00:00.000Z",
            batteryDecision: {
                action: "hold",
                dischargeAllowed: false,
                requiredSocAtPvEndPct: 30,
                holdActive: true,
                reasonCode: "battery_hold_active",
            },
        }));
        fillSocRange(day, "2026-06-15T18:00:00.000Z", "2026-06-15T22:00:00.000Z", 40);
        const findings = (0, battery_findings_js_1.evaluateBatteryFindings)(day, null);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0].insufficientData, false);
        strict_1.default.ok(findings[0].reasonCodes.includes("reserve_held"));
        strict_1.default.equal(findings[0].quality.outcomeQuality, "reasonable");
    });
    (0, node_test_1.it)("Reserve unterschritten → reserve_undercut, outcomeQuality unknown (keine Ursachen-Attribution)", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T18:00:00.000Z",
            batteryDecision: {
                action: "discharge_allowed",
                dischargeAllowed: true,
                requiredSocAtPvEndPct: 30,
                holdActive: false,
                reasonCode: "price_and_reserve_ok",
            },
        }));
        fillSocRange(day, "2026-06-15T18:00:00.000Z", "2026-06-15T22:00:00.000Z", 25);
        const findings = (0, battery_findings_js_1.evaluateBatteryFindings)(day, null);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.ok(findings[0].reasonCodes.includes("reserve_undercut"));
        strict_1.default.equal(findings[0].quality.outcomeQuality, "unknown");
        strict_1.default.equal(findings[0].quality.decisionQuality, "reasonable");
    });
    (0, node_test_1.it)("zu wenig SOC-Daten im Fenster → insufficientData=true, keine Behauptung", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T18:00:00.000Z",
            batteryDecision: {
                action: "discharge_allowed",
                dischargeAllowed: true,
                requiredSocAtPvEndPct: 30,
                holdActive: false,
                reasonCode: "price_and_reserve_ok",
            },
        }));
        const findings = (0, battery_findings_js_1.evaluateBatteryFindings)(day, null);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0].insufficientData, true);
    });
    (0, node_test_1.it)("Cross-Midnight: Tiefpunkt im Folgetag wird berücksichtigt, wenn nextDay vorliegt", () => {
        const day = (0, test_helpers_js_1.freshDay)("2026-06-15");
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T22:00:00.000Z",
            batteryDecision: {
                action: "discharge_allowed",
                dischargeAllowed: true,
                requiredSocAtPvEndPct: 30,
                holdActive: false,
                reasonCode: "price_and_reserve_ok",
            },
        }));
        const nextDay = (0, test_helpers_js_1.freshDay)("2026-06-16");
        fillSocRange(nextDay, "2026-06-15T22:00:00.000Z", "2026-06-16T08:00:00.000Z", 18); /* Tiefpunkt vor Sonnenaufgang */
        fillSocRange(nextDay, "2026-06-16T08:00:00.000Z", "2026-06-16T16:00:00.000Z", 25);
        const findings = (0, battery_findings_js_1.evaluateBatteryFindings)(day, nextDay);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.ok(findings[0].reasonCodes.includes("reserve_undercut"));
        strict_1.default.equal(findings[0].measurements.observedMinSocPct, 18);
    });
    (0, node_test_1.it)("nextDay fehlt trotz Cross-Midnight-Fenster → insufficientData statt Rekonstruktion", () => {
        const day = (0, test_helpers_js_1.freshDay)("2026-06-15");
        day.forecastSnapshots.push((0, test_helpers_js_1.makeSnapshot)({
            tsIso: "2026-06-15T22:00:00.000Z",
            batteryDecision: {
                action: "discharge_allowed",
                dischargeAllowed: true,
                requiredSocAtPvEndPct: 30,
                holdActive: false,
                reasonCode: "price_and_reserve_ok",
            },
        }));
        const findings = (0, battery_findings_js_1.evaluateBatteryFindings)(day, null);
        strict_1.default.equal(findings.length, 1);
        strict_1.default.equal(findings[0].insufficientData, true);
    });
});
