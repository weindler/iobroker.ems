"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const feedback_js_1 = require("./feedback.js");
(0, node_test_1.describe)("battery feedback", () => {
    (0, node_test_1.it)("mode feedback ok when actual matches", () => {
        strict_1.default.equal((0, feedback_js_1.checkModeFeedback)({ expectedMode: 1, actualMode: 1, elapsedMs: 0, timeoutMs: 1000 }), "ok");
    });
    (0, node_test_1.it)("mode feedback pending then timeout", () => {
        strict_1.default.equal((0, feedback_js_1.checkModeFeedback)({ expectedMode: 1, actualMode: 2, elapsedMs: 0, timeoutMs: 1000 }), "pending");
        strict_1.default.equal((0, feedback_js_1.checkModeFeedback)({ expectedMode: 1, actualMode: 2, elapsedMs: 1000, timeoutMs: 1000 }), "timeout");
    });
    (0, node_test_1.it)("charge within tolerance (absolute and relative)", () => {
        const tol = { absoluteW: 500, relativePct: 10 };
        strict_1.default.equal((0, feedback_js_1.chargeWithinTolerance)(2000, 2300, tol), true);
        strict_1.default.equal((0, feedback_js_1.chargeWithinTolerance)(2000, 2600, tol), false);
        strict_1.default.equal((0, feedback_js_1.chargeWithinTolerance)(10000, 10900, tol), true);
    });
    (0, node_test_1.it)("charge feedback timeout on deviation", () => {
        const tol = { absoluteW: 100, relativePct: 5 };
        strict_1.default.equal((0, feedback_js_1.checkChargeFeedback)({ expectedW: 2000, actualChargingW: 0, elapsedMs: 5000, timeoutMs: 1000, tolerance: tol }), "timeout");
    });
});
