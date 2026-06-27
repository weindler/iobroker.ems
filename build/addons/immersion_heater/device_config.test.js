"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_js_1 = require("./device_config.js");
(0, node_test_1.describe)("immersion device config", () => {
    (0, node_test_1.it)("migrates set_enabled to stage 1", () => {
        const cfg = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
            ih_set_enabled_target: "mqtt.0.heater.switch",
            ih_buffer_temp_c_target: "mqtt.0.temp",
            ih_buffer_temp_c_enabled: true,
        });
        strict_1.default.equal(cfg.stages[0].setStateId, "mqtt.0.heater.switch");
        strict_1.default.equal(cfg.stageCount, 1);
        strict_1.default.equal(cfg.planningMinTempC, 48);
        strict_1.default.equal(cfg.planningMaxTempC, 60);
    });
});
