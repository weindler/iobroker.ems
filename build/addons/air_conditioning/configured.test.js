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
    (0, node_test_1.it)("ignores disabled unit even with mapping targets (ensure only enabled)", () => {
        const cfg = {
            ac_u1_enabled: false,
            ac_u1_feedback_switch_target: "smartthings.0.devices.x.switch",
            ac_u2_enabled: true,
        };
        strict_1.default.equal((0, configured_js_1.isAcUnitConfigured)(cfg, 1), false);
        strict_1.default.equal((0, configured_js_1.isAcUnitConfigured)(cfg, 2), true);
        strict_1.default.deepEqual((0, configured_js_1.configuredAcUnitIndexes)(cfg), [2]);
    });
    (0, node_test_1.it)("limits mapping commands to enabled units with mapped roles only", () => {
        const cmds = (0, configured_js_1.acMappingCommandsForConfiguredUnits)({
            ac_u1_enabled: true,
            ac_u1_cmd_switch_off_target: "ac.0.off",
            ac_u1_cmd_switch_off_enabled: true,
            ac_u2_enabled: true,
            ac_u2_room_temp_target: "temp.0.x",
            ac_u3_enabled: false,
            ac_u3_room_temp_target: "temp.0.y",
        });
        strict_1.default.deepEqual(cmds.sort(), ["unit_1_cmd_switch_off", "unit_2_room_temp"].sort());
        strict_1.default.ok(!cmds.some((c) => c.startsWith("unit_3_")));
    });
    (0, node_test_1.it)("enabled unit without mappings yields no mapping commands", () => {
        strict_1.default.deepEqual((0, configured_js_1.acMappingCommandsForConfiguredUnits)({ ac_u1_enabled: true }), []);
    });
    (0, node_test_1.it)("acMappingFromConfig only emits enabled units with mapped roles", async () => {
        const { acMappingFromConfig } = await import("./mapping_config.js");
        const entries = acMappingFromConfig({
            ac_u1_enabled: true,
            ac_u1_room_temp_enabled: true,
            ac_u1_room_temp_target: "temp.0.a",
            ac_u3_enabled: false,
            ac_u3_room_temp_enabled: true,
            ac_u3_room_temp_target: "temp.0.x",
        });
        strict_1.default.ok(Object.keys(entries).every((k) => k.startsWith("unit_1_")));
        strict_1.default.equal(entries["unit_3_room_temp"], undefined);
    });
});
