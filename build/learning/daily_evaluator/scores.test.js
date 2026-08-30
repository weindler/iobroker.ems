"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const test_helpers_js_1 = require("./test_helpers.js");
const scores_js_1 = require("./scores.js");
const types_js_1 = require("./types.js");
(0, node_test_1.describe)("daily_evaluator scores", () => {
    (0, node_test_1.it)("batteryScore: reserve_held_ratio aus konklusiven Reserve-Checks", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_held"] }),
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", reasonCodes: ["reserve_undercut"] }),
        ];
        const scores = (0, scores_js_1.computeDomainScores)(day, findings);
        const battery = scores.find((s) => s.topic === types_js_1.SCORE_TOPIC.BATTERY);
        strict_1.default.equal(battery.value, 66.7);
        strict_1.default.equal(battery.sampleCount, 3);
    });
    (0, node_test_1.it)("batteryScore: keine konklusiven Checks → value null, keine erfundene Zahl", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "battery", eventType: "battery_reserve_check", insufficientData: true, reasonCodes: ["reserve_check_window_undercovered"] }),
        ];
        const scores = (0, scores_js_1.computeDomainScores)(day, findings);
        const battery = scores.find((s) => s.topic === types_js_1.SCORE_TOPIC.BATTERY);
        strict_1.default.equal(battery.value, null);
        strict_1.default.equal(battery.sampleCount, 0);
    });
    (0, node_test_1.it)("thermalScore: Mittel aus outcomeQuality-Klassifikation nutzbarer Findings", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "thermal", quality: { decisionQuality: "reasonable", outcomeQuality: "reasonable" } }),
            (0, test_helpers_js_1.makeFinding)({ domain: "thermal", quality: { decisionQuality: "wasteful", outcomeQuality: "wasteful" } }),
            (0, test_helpers_js_1.makeFinding)({ domain: "thermal", quality: { decisionQuality: "unknown", outcomeQuality: "unknown" }, insufficientData: true }),
        ];
        const scores = (0, scores_js_1.computeDomainScores)(day, findings);
        const thermal = scores.find((s) => s.topic === types_js_1.SCORE_TOPIC.THERMAL);
        strict_1.default.equal(thermal.value, 50);
        strict_1.default.equal(thermal.sampleCount, 2);
    });
    (0, node_test_1.it)("evScore: readiness_met_ratio aus konklusiven Readiness-Checks", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const findings = [
            (0, test_helpers_js_1.makeFinding)({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_met"] }),
            (0, test_helpers_js_1.makeFinding)({ domain: "ev", eventType: "ev_readiness_check", reasonCodes: ["ev_readiness_missed"] }),
        ];
        const scores = (0, scores_js_1.computeDomainScores)(day, findings);
        const ev = scores.find((s) => s.topic === types_js_1.SCORE_TOPIC.EV);
        strict_1.default.equal(ev.value, 50);
        strict_1.default.equal(ev.sampleCount, 2);
    });
    (0, node_test_1.it)("pvUtilizationScore: rein deskriptiv aus PV-/Export-Buckets, keine PV-Produktion → null", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const scores = (0, scores_js_1.computeDomainScores)(day, []);
        const pv = scores.find((s) => s.topic === types_js_1.SCORE_TOPIC.PV);
        strict_1.default.equal(pv.value, null);
    });
    (0, node_test_1.it)("pvUtilizationScore: Eigenverbrauchsanteil aus pvKwh/gridExportKwh", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        day.buckets.pvKwh[0] = 10;
        day.buckets.gridExportKwh[0] = 4;
        const scores = (0, scores_js_1.computeDomainScores)(day, []);
        const pv = scores.find((s) => s.topic === types_js_1.SCORE_TOPIC.PV);
        strict_1.default.equal(pv.value, 60);
    });
    (0, node_test_1.it)("comfortScore ist immer null (keine Komfort-Telemetrie) — keine Scheingenauigkeit", () => {
        const day = (0, test_helpers_js_1.freshDay)();
        const scores = (0, scores_js_1.computeDomainScores)(day, []);
        const comfort = scores.find((s) => s.topic === types_js_1.SCORE_TOPIC.COMFORT);
        strict_1.default.equal(comfort.value, null);
    });
    (0, node_test_1.it)("computeGlobalScore: nur usable Topics fließen ein, Gewichte summieren zu 1", () => {
        const scores = [
            { topic: types_js_1.SCORE_TOPIC.BATTERY, value: 100, sampleCount: 1, basis: "x" },
            { topic: types_js_1.SCORE_TOPIC.THERMAL, value: 0, sampleCount: 1, basis: "x" },
            { topic: types_js_1.SCORE_TOPIC.EV, value: null, sampleCount: 0, basis: "x" },
            { topic: types_js_1.SCORE_TOPIC.COMFORT, value: null, sampleCount: 0, basis: "x" },
        ];
        const { globalScore, weights } = (0, scores_js_1.computeGlobalScore)(scores);
        strict_1.default.equal(globalScore, 50);
        strict_1.default.equal(Object.keys(weights).length, 2);
        const weightSum = Object.values(weights).reduce((a, b) => a + b, 0);
        strict_1.default.ok(Math.abs(weightSum - 1) < 1e-9);
    });
    (0, node_test_1.it)("computeGlobalScore: keine usable Topics → null statt erfundener Zahl", () => {
        const scores = [{ topic: types_js_1.SCORE_TOPIC.BATTERY, value: null, sampleCount: 0, basis: "x" }];
        const { globalScore, weights } = (0, scores_js_1.computeGlobalScore)(scores);
        strict_1.default.equal(globalScore, null);
        strict_1.default.deepEqual(weights, {});
    });
});
