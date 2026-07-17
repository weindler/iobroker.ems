"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const authorization_mode_js_1 = require("./authorization_mode.js");
(0, node_test_1.describe)("planner_config authorization mode", () => {
    (0, node_test_1.it)("default is disabled", () => {
        strict_1.default.equal(authorization_mode_js_1.PLANNER_TAKEOVER_AUTHORIZATION_MODE_DEFAULT, "disabled");
    });
    (0, node_test_1.it)("missing migrates to disabled", () => {
        strict_1.default.equal((0, authorization_mode_js_1.plannerTakeoverAuthorizationModeFromConfig)({}).mode, "disabled");
    });
    (0, node_test_1.it)("invalid clamps", () => {
        strict_1.default.equal((0, authorization_mode_js_1.parsePlannerTakeoverAuthorizationMode)("yes").clamped, true);
    });
    (0, node_test_1.it)("manual_prepare accepted", () => {
        strict_1.default.equal((0, authorization_mode_js_1.plannerTakeoverAuthorizationModeFromConfig)({
            planner_takeover_authorization_mode: "manual_prepare",
        }).mode, "manual_prepare");
    });
});
