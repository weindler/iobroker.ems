"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const types_js_1 = require("./types.js");
const learning_math_js_1 = require("./learning_math.js");
(0, node_test_1.describe)("daily_evaluator learning_math", () => {
    (0, node_test_1.it)("confidenceFromSampleCount: unter Mindestanzahl → null", () => {
        strict_1.default.equal((0, learning_math_js_1.confidenceFromSampleCount)(learning_math_js_1.LEARNING_MIN_SAMPLES_FOR_CONFIDENCE - 1, 20), null);
    });
    (0, node_test_1.it)("confidenceFromSampleCount: skaliert bis targetSamples, dann gekappt auf 100", () => {
        strict_1.default.equal((0, learning_math_js_1.confidenceFromSampleCount)(10, 20), 50);
        strict_1.default.equal((0, learning_math_js_1.confidenceFromSampleCount)(20, 20), 100);
        strict_1.default.equal((0, learning_math_js_1.confidenceFromSampleCount)(40, 20), 100);
    });
    (0, node_test_1.it)("updateLearningMetric: erstes Sample setzt Mittelwert direkt", () => {
        const m = (0, learning_math_js_1.updateLearningMetric)((0, types_js_1.emptyLearningMetric)(), 42, "2026-06-15T10:00:00.000Z", 20);
        strict_1.default.equal(m.value, 42);
        strict_1.default.equal(m.sampleCount, 1);
        strict_1.default.equal(m.min, 42);
        strict_1.default.equal(m.max, 42);
        strict_1.default.equal(m.variance, 0);
    });
    (0, node_test_1.it)("updateLearningMetric: Online-Mittelwert über mehrere Samples entspricht dem einfachen Mittel", () => {
        let m = (0, types_js_1.emptyLearningMetric)();
        const values = [10, 20, 30, 40];
        for (const v of values)
            m = (0, learning_math_js_1.updateLearningMetric)(m, v, "2026-06-15T10:00:00.000Z", 20);
        strict_1.default.equal(m.value, 25);
        strict_1.default.equal(m.sampleCount, 4);
        strict_1.default.equal(m.min, 10);
        strict_1.default.equal(m.max, 40);
    });
    (0, node_test_1.it)("updateLearningMetric: Varianz für konstante Werte ist 0", () => {
        let m = (0, types_js_1.emptyLearningMetric)();
        for (let i = 0; i < 5; i++)
            m = (0, learning_math_js_1.updateLearningMetric)(m, 100, "2026-06-15T10:00:00.000Z", 20);
        strict_1.default.equal(m.value, 100);
        strict_1.default.equal(m.variance, 0);
    });
    (0, node_test_1.it)("updateLearningMetric: NaN/Infinity wird ignoriert (kein Sample-Zuwachs)", () => {
        const before = (0, learning_math_js_1.updateLearningMetric)((0, types_js_1.emptyLearningMetric)(), 5, "2026-06-15T10:00:00.000Z", 20);
        const after = (0, learning_math_js_1.updateLearningMetric)(before, Number.NaN, "2026-06-15T11:00:00.000Z", 20);
        strict_1.default.deepEqual(after, before);
    });
    (0, node_test_1.it)("updateLearningMetric: periodStartIso bleibt beim ersten Wert, periodEndIso wird fortgeschrieben", () => {
        let m = (0, learning_math_js_1.updateLearningMetric)((0, types_js_1.emptyLearningMetric)(), 1, "2026-06-15T10:00:00.000Z", 20);
        m = (0, learning_math_js_1.updateLearningMetric)(m, 2, "2026-06-16T10:00:00.000Z", 20);
        strict_1.default.equal(m.periodStartIso, "2026-06-15T10:00:00.000Z");
        strict_1.default.equal(m.periodEndIso, "2026-06-16T10:00:00.000Z");
    });
});
