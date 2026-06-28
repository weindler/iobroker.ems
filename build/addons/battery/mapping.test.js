"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const mapping_js_1 = require("./mapping.js");
(0, node_test_1.describe)("battery mapping", () => {
    (0, node_test_1.it)("parses flat config keys", () => {
        const t = (0, mapping_js_1.batteryMappingFromConfig)({ bat_soc_target: "x.soc", bat_soc_enabled: true });
        strict_1.default.equal(t.soc_pct.targetState, "x.soc");
        strict_1.default.equal(t.soc_pct.enabled, true);
        strict_1.default.equal((0, mapping_js_1.isMappingConfigured)(t, "soc_pct"), true);
    });
    (0, node_test_1.it)("operating_mode_read falls back to write target", () => {
        const t = (0, mapping_js_1.batteryMappingFromConfig)({ bat_operating_mode_target: "sonnen.0.EM_OperatingMode" });
        strict_1.default.equal(t.operating_mode_read.targetState, "sonnen.0.EM_OperatingMode");
    });
    (0, node_test_1.it)("missing required mappings reported", () => {
        const t = (0, mapping_js_1.batteryMappingFromConfig)({});
        strict_1.default.deepEqual((0, mapping_js_1.missingMappings)(t, ["soc_pct", "power_w"]).sort(), ["power_w", "soc_pct"]);
    });
    (0, node_test_1.it)("disabled mapping not configured", () => {
        const t = (0, mapping_js_1.batteryMappingFromConfig)({ bat_soc_target: "x.soc", bat_soc_enabled: false });
        strict_1.default.equal((0, mapping_js_1.isMappingConfigured)(t, "soc_pct"), false);
    });
});
