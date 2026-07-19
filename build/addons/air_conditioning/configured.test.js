"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
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
    (0, node_test_1.it)("limits mapping commands to enabled units only", () => {
        const cmds = (0, configured_js_1.acMappingCommandsForConfiguredUnits)({
            ac_u1_enabled: true,
            ac_u2_enabled: true,
            ac_u3_enabled: false,
            ac_u3_room_temp_target: "temp.0.x",
        });
        strict_1.default.ok(cmds.every((c) => c.startsWith("unit_1_") || c.startsWith("unit_2_")));
        strict_1.default.ok(cmds.includes("unit_1_cmd_switch_off"));
        strict_1.default.ok(!cmds.some((c) => c.startsWith("unit_3_")));
    });
    (0, node_test_1.it)("acMappingFromConfig only emits enabled units", async () => {
        const { acMappingFromConfig } = await Promise.resolve().then(() => __importStar(require("./mapping_config.js")));
        const entries = acMappingFromConfig({
            ac_u1_enabled: true,
            ac_u1_room_temp_enabled: true,
            ac_u3_enabled: false,
            ac_u3_room_temp_enabled: true,
            ac_u3_room_temp_target: "temp.0.x",
        });
        strict_1.default.ok(Object.keys(entries).every((k) => k.startsWith("unit_1_")));
        strict_1.default.equal(entries["unit_3_room_temp"], undefined);
    });
});
