"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const control_mapping_js_1 = require("./control_mapping.js");
(0, node_test_1.describe)("wallbox control mapping snapshot", () => {
    (0, node_test_1.it)("reads configured legacy roles from config", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_enabled_enabled: true,
                wb_set_current_a_target: "go-e.0.amperePV",
                wb_set_current_a_enabled: true,
            },
            telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "evcc.0.power" },
        });
        strict_1.default.equal(snap.controlModel, "legacy_goe");
        strict_1.default.equal(snap.setEnabled?.targetStateId, "go-e.0.allow_charging");
        strict_1.default.equal(snap.setEnabled?.targetKind, "goe_direct");
        strict_1.default.equal(snap.chargeControlRole, "set_current_a");
        strict_1.default.equal(snap.missingRoles.length, 0);
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
    });
    (0, node_test_1.it)("blocks ambiguous same-target current and power mappings", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_enabled_enabled: true,
                wb_set_current_a_target: "go-e.0.amperePV",
                wb_set_current_a_enabled: true,
                wb_set_charge_power_w_target: "go-e.0.amperePV",
                wb_set_charge_power_w_enabled: true,
            },
            telemetryCfg: { enabledStateId: "", chargePowerWStateId: "" },
        });
        strict_1.default.equal(snap.ambiguousPowerControl, true);
        strict_1.default.equal(snap.mappingConflictReason, "ambiguous_power_control_mapping");
        strict_1.default.equal(snap.chargeControlRole, null);
    });
    (0, node_test_1.it)("uses power role when current missing and targets differ", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_enabled_enabled: true,
                wb_set_charge_power_w_target: "go-e.0.power",
                wb_set_charge_power_w_enabled: true,
            },
            telemetryCfg: { enabledStateId: "", chargePowerWStateId: "evcc.0.power" },
        });
        strict_1.default.equal(snap.chargeControlRole, "set_charge_power_w");
        strict_1.default.equal(snap.ambiguousPowerControl, false);
    });
    (0, node_test_1.it)("reports missing enable role", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: { wb_set_current_a_target: "go-e.0.ampere", wb_set_current_a_enabled: true },
            telemetryCfg: { enabledStateId: "", chargePowerWStateId: "" },
        });
        strict_1.default.ok(snap.missingRoles.includes("set_enabled"));
    });
    (0, node_test_1.it)("confirms EVCC control path only when all write targets are evcc.*", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_set_enabled_target: "evcc.0.loadpoint.1.enabled",
                wb_set_enabled_enabled: true,
                wb_set_current_a_target: "evcc.0.loadpoint.1.minCurrent",
                wb_set_current_a_enabled: true,
            },
            telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "" },
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, true);
        strict_1.default.equal((0, control_mapping_js_1.classifyWallboxControlTargetKind)("evcc.0.loadpoint.1.enabled"), "evcc");
    });
    (0, node_test_1.it)("does not treat direct go-e targets as EVCC-compatible", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_enabled_enabled: true,
                wb_set_current_a_target: "go-e.0.amperePV",
                wb_set_current_a_enabled: true,
            },
            telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "" },
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
        strict_1.default.equal((0, control_mapping_js_1.classifyWallboxControlTargetKind)("go-e.0.allow_charging"), "goe_direct");
    });
});
