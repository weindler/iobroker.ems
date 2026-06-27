"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_js_1 = require("./device_config.js");
const validate_config_js_1 = require("./validate_config.js");
(0, node_test_1.describe)("immersion config validation", () => {
    (0, node_test_1.it)("rejects invalid temperature window", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_planning_min_temp_c: 60,
            ih_planning_max_temp_c: 48,
            ih_set_enabled_target: "x",
            ih_buffer_temp_c_target: "t",
            ih_stage_1_nominal_power_w: 2000,
        });
        const v = (0, validate_config_js_1.validateImmersionDeviceConfig)(cfg);
        strict_1.default.equal(v.valid, false);
        strict_1.default.ok(v.errors.includes("planning_min_temp_c_must_be_below_max"));
    });
    (0, node_test_1.it)("accepts migrated single-stage config with power", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "relay.0",
            ih_buffer_temp_c_target: "temp.0",
            ih_stage_1_nominal_power_w: 3000,
        });
        const v = (0, validate_config_js_1.validateImmersionDeviceConfig)(cfg);
        strict_1.default.equal(v.valid, true);
    });
});
