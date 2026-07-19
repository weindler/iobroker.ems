"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const configured_js_1 = require("./configured.js");
(0, node_test_1.describe)("ac unit configured detection", () => {
    (0, node_test_1.it)("treats empty default slots as not configured", () => {
        strict_1.default.equal((0, configured_js_1.isAcUnitConfigured)({}, 1), false);
        strict_1.default.deepEqual((0, configured_js_1.configuredAcUnitIndexes)({}), []);
        strict_1.default.deepEqual((0, configured_js_1.acMappingCommandsForConfiguredUnits)({}), []);
    });
    (0, node_test_1.it)("treats enabled unit as configured even without mappings", () => {
        strict_1.default.equal((0, configured_js_1.isAcUnitConfigured)({ ac_u2_enabled: true }, 2), true);
        strict_1.default.deepEqual((0, configured_js_1.configuredAcUnitIndexes)({ ac_u2_enabled: true }), [2]);
    });
    (0, node_test_1.it)("treats disabled unit with mapping target as configured", () => {
        const cfg = {
            ac_u1_enabled: false,
            ac_u1_feedback_switch_target: "smartthings.0.devices.x.switch",
        };
        strict_1.default.equal((0, configured_js_1.isAcUnitConfigured)(cfg, 1), true);
        strict_1.default.equal((0, configured_js_1.isAcUnitConfigured)(cfg, 3), false);
    });
    (0, node_test_1.it)("limits mapping commands to configured units only", () => {
        const cmds = (0, configured_js_1.acMappingCommandsForConfiguredUnits)({ ac_u1_enabled: true });
        strict_1.default.ok(cmds.every((c) => c.startsWith("unit_1_")));
        strict_1.default.ok(cmds.includes("unit_1_cmd_switch_off"));
        strict_1.default.ok(!cmds.some((c) => c.startsWith("unit_2_")));
    });
});
