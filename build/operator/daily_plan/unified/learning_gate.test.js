"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const learning_gate_js_1 = require("./learning_gate.js");
(0, node_test_1.describe)("Block B — learning gate", () => {
    const cfg = { minSampleCount: 5, minConfidencePct: 60 };
    (0, node_test_1.it)("Confidence unbekannt → nicht nutzbar (learning_gate_signal_unknown)", () => {
        const r = (0, learning_gate_js_1.evaluateLearningGate)({ sampleCount: 10, confidencePct: null }, cfg);
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(!r.usable && r.reasonCode, "learning_gate_signal_unknown");
    });
    (0, node_test_1.it)("Sample-Count zu niedrig → nicht nutzbar (learning_gate_sample_count_low)", () => {
        const r = (0, learning_gate_js_1.evaluateLearningGate)({ sampleCount: 2, confidencePct: 90 }, cfg);
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(!r.usable && r.reasonCode, "learning_gate_sample_count_low");
    });
    (0, node_test_1.it)("Confidence zu niedrig → nicht nutzbar (learning_gate_confidence_low)", () => {
        const r = (0, learning_gate_js_1.evaluateLearningGate)({ sampleCount: 10, confidencePct: 40 }, cfg);
        strict_1.default.equal(r.usable, false);
        strict_1.default.equal(!r.usable && r.reasonCode, "learning_gate_confidence_low");
    });
    (0, node_test_1.it)("sampleCount null gilt als nicht anwendbar, nicht als Ablehnung", () => {
        const r = (0, learning_gate_js_1.evaluateLearningGate)({ sampleCount: null, confidencePct: 90 }, cfg);
        strict_1.default.equal(r.usable, true);
    });
    (0, node_test_1.it)("beide Schwellen erfüllt → nutzbar", () => {
        const r = (0, learning_gate_js_1.evaluateLearningGate)({ sampleCount: 10, confidencePct: 90 }, cfg);
        strict_1.default.equal(r.usable, true);
    });
    (0, node_test_1.it)("clampToBounds hält Werte in Grenzen, NaN → min", () => {
        strict_1.default.equal((0, learning_gate_js_1.clampToBounds)(5, 0, 10), 5);
        strict_1.default.equal((0, learning_gate_js_1.clampToBounds)(-5, 0, 10), 0);
        strict_1.default.equal((0, learning_gate_js_1.clampToBounds)(50, 0, 10), 10);
        strict_1.default.equal((0, learning_gate_js_1.clampToBounds)(Number.NaN, 2, 10), 2);
    });
});
