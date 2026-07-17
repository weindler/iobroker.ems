"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const runtime_mode_js_1 = require("./runtime_mode.js");
(0, node_test_1.describe)("planner_config runtime mode", () => {
    (0, node_test_1.it)("defaults to off", () => {
        strict_1.default.equal(runtime_mode_js_1.PLANNER_RUNTIME_MODE_DEFAULT, "off");
        strict_1.default.equal((0, runtime_mode_js_1.parsePlannerRuntimeMode)(undefined).mode, "off");
        strict_1.default.equal((0, runtime_mode_js_1.parsePlannerRuntimeMode)(null).mode, "off");
        strict_1.default.equal((0, runtime_mode_js_1.parsePlannerRuntimeMode)("").mode, "off");
    });
    (0, node_test_1.it)("clamps invalid values to off", () => {
        const parsed = (0, runtime_mode_js_1.parsePlannerRuntimeMode)("live");
        strict_1.default.equal(parsed.mode, "off");
        strict_1.default.equal(parsed.clamped, true);
    });
    (0, node_test_1.it)("accepts shadow_manual and shadow_auto", () => {
        strict_1.default.equal((0, runtime_mode_js_1.parsePlannerRuntimeMode)("shadow_manual").mode, "shadow_manual");
        strict_1.default.equal((0, runtime_mode_js_1.parsePlannerRuntimeMode)("shadow_auto").mode, "shadow_auto");
    });
    (0, node_test_1.it)("reads from config object", () => {
        strict_1.default.equal((0, runtime_mode_js_1.plannerRuntimeModeFromConfig)({ planner_runtime_mode: "shadow_auto" }).mode, "shadow_auto");
        strict_1.default.equal((0, runtime_mode_js_1.plannerRuntimeModeFromConfig)({}).mode, "off");
    });
});
