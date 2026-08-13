"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const evcc_control_config_js_1 = require("./evcc_control_config.js");
(0, node_test_1.describe)("evcc control config", () => {
    (0, node_test_1.it)("defaults new install to evcc control model", () => {
        strict_1.default.equal((0, evcc_control_config_js_1.resolveWallboxControlModel)({}), "evcc");
    });
    (0, node_test_1.it)("existing legacy mappings without explicit model stay none", () => {
        strict_1.default.equal((0, evcc_control_config_js_1.resolveWallboxControlModel)({ wb_set_enabled_target: "go-e.0.allow_charging" }), "none");
    });
    (0, node_test_1.it)("explicit legacy_direct is honored", () => {
        strict_1.default.equal((0, evcc_control_config_js_1.resolveWallboxControlModel)({
            wb_control_model: "legacy_direct",
            wb_set_enabled_target: "go-e.0.allow_charging",
        }), "legacy_direct");
    });
    (0, node_test_1.it)("detects evcc control write mappings", () => {
        strict_1.default.equal((0, evcc_control_config_js_1.hasEvccControlWriteMapping)({
            wb_evcc_set_mode_target: "evcc.0.loadpoint.1.mode",
        }), true);
    });
    (0, node_test_1.it)("collects evcc target state ids", () => {
        const ids = (0, evcc_control_config_js_1.collectConfiguredControlTargetStateIds)({
            wb_control_model: "evcc",
            wb_evcc_set_mode_target: "evcc.0.loadpoint.1.mode",
            wb_evcc_set_max_current_a_target: "evcc.0.loadpoint.1.maxCurrent",
        });
        strict_1.default.deepEqual(ids.sort(), [
            "evcc.0.loadpoint.1.maxCurrent",
            "evcc.0.loadpoint.1.mode",
        ]);
    });
    (0, node_test_1.it)("control v1 contract is ready only with all three evcc control.* targets", () => {
        const ready = (0, evcc_control_config_js_1.resolveEvccControlContractV1)({
            wb_evcc_control_pv_control_target: "evcc.0.loadpoint.1.control.pvControl",
            wb_evcc_control_max_current_target: "evcc.0.loadpoint.1.control.maxCurrent",
            wb_evcc_control_phases_configured_target: "evcc.0.loadpoint.1.control.phasesConfigured",
        });
        strict_1.default.equal(ready.ready, true);
        strict_1.default.equal(ready.usesLegacyGoeFallback, false);
    });
    (0, node_test_1.it)("control v1 never accepts go-e ids", () => {
        const contract = (0, evcc_control_config_js_1.resolveEvccControlContractV1)({
            wb_control_model: "evcc",
            wb_evcc_control_pv_control_target: "go-e.0.allow_charging",
            wb_evcc_control_max_current_target: "go-e.0.amperePV",
            wb_evcc_control_phases_configured_target: "go-e.0.phaseSwitchModeEnabled",
        });
        strict_1.default.equal(contract.ready, false);
        const ids = (0, evcc_control_config_js_1.collectConfiguredControlTargetStateIds)({
            wb_control_model: "evcc",
            wb_set_current_a_target: "go-e.0.amperePV",
            wb_evcc_control_pv_control_target: "go-e.0.allow_charging",
        });
        strict_1.default.ok(ids.every((id) => !id.startsWith("go-e.")));
    });
});
