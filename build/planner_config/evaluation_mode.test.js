"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const evaluation_mode_js_1 = require("./evaluation_mode.js");
(0, node_test_1.describe)("planner_config evaluation mode", () => {
    (0, node_test_1.it)("default is disabled", () => {
        strict_1.default.equal(evaluation_mode_js_1.PLANNER_TAKEOVER_EVALUATION_MODE_DEFAULT, "disabled");
    });
    (0, node_test_1.it)("missing migrates to disabled", () => {
        strict_1.default.equal((0, evaluation_mode_js_1.plannerTakeoverEvaluationModeFromConfig)({}).mode, "disabled");
        strict_1.default.equal((0, evaluation_mode_js_1.parsePlannerTakeoverEvaluationMode)(null).mode, "disabled");
    });
    (0, node_test_1.it)("invalid clamps to disabled", () => {
        const p = (0, evaluation_mode_js_1.parsePlannerTakeoverEvaluationMode)("on");
        strict_1.default.equal(p.mode, "disabled");
        strict_1.default.equal(p.clamped, true);
    });
    (0, node_test_1.it)("observe is accepted", () => {
        const p = (0, evaluation_mode_js_1.plannerTakeoverEvaluationModeFromConfig)({
            planner_takeover_evaluation_mode: "observe",
        });
        strict_1.default.equal(p.mode, "observe");
        strict_1.default.equal(p.clamped, false);
    });
});
