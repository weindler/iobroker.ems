"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Lückenschutz: Zählerdifferenz einer Adapter-Pause wird nicht dem laufenden Tag zugerechnet.
 */
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const compute_js_1 = require("./compute.js");
(0, node_test_1.describe)("isCounterGap", () => {
    const now = Date.UTC(2026, 10, 12, 17, 0, 0);
    (0, node_test_1.it)("normaler Tick-Abstand ist keine Lücke", () => {
        strict_1.default.equal((0, compute_js_1.isCounterGap)(now - 10_000, now), false);
        strict_1.default.equal((0, compute_js_1.isCounterGap)(now - 5 * 60_000, now), false);
    });
    (0, node_test_1.it)("genau an der Grenze ist noch keine Lücke, darüber schon", () => {
        strict_1.default.equal((0, compute_js_1.isCounterGap)(now - compute_js_1.COUNTER_MAX_GAP_MS, now), false);
        strict_1.default.equal((0, compute_js_1.isCounterGap)(now - compute_js_1.COUNTER_MAX_GAP_MS - 1, now), true);
    });
    (0, node_test_1.it)("Wochenlange Adapter-Pause ist eine Lücke", () => {
        strict_1.default.equal((0, compute_js_1.isCounterGap)(now - 40 * 24 * 3600_000, now), true);
    });
    (0, node_test_1.it)("ohne bekannte letzte Ablesung keine Lücke (erster Start)", () => {
        strict_1.default.equal((0, compute_js_1.isCounterGap)(null, now), false);
        strict_1.default.equal((0, compute_js_1.isCounterGap)(undefined, now), false);
        strict_1.default.equal((0, compute_js_1.isCounterGap)(Number.NaN, now), false);
    });
});
