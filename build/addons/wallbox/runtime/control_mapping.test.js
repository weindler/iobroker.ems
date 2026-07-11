"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const control_mapping_js_1 = require("./control_mapping.js");
function meta(id, commonType, writable = true, allowedStateKeys = null) {
    return {
        stateId: id,
        objectPresent: true,
        writable,
        commonType,
        allowedStateKeys,
    };
}
const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX_CURRENT = "evcc.0.loadpoint.1.maxCurrent";
const EVCC_ENABLED = "evcc.0.loadpoint.1.enabled";
const EVCC_MIN_CURRENT = "evcc.0.loadpoint.1.minCurrent";
const MODE_STATES = ["pv", "off", "now"];
function evccTelemetryCfg() {
    return {
        enabledStateId: "evcc.0.loadpoint.1.enabled",
        maxCurrentAStateId: "evcc.0.telemetry.maxCurrent",
        modeReadbackStateId: "evcc.0.loadpoint.1.mode",
    };
}
function validEvccConfig(over = {}) {
    return {
        wb_control_model: "evcc",
        wb_evcc_set_mode_target: EVCC_MODE,
        wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
        wb_evcc_mode_charge_value: "pv",
        wb_evcc_mode_hold_value: "off",
        ...over,
    };
}
function validEvccMetas(over = {}) {
    return {
        [EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
        [EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
        ...over,
    };
}
(0, node_test_1.describe)("wallbox control mapping snapshot", () => {
    (0, node_test_1.it)("evcc model without mapping is blocked", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: { wb_control_model: "evcc" },
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: {},
        });
        strict_1.default.equal(snap.controlModel, "evcc");
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
        strict_1.default.equal(snap.liveEligible, false);
        strict_1.default.ok(snap.missingRoles.includes("set_mode"));
        strict_1.default.ok(snap.missingRoles.includes("set_max_current_a"));
    });
    (0, node_test_1.it)("evcc model with maxCurrent and mode is confirmed and live-eligible", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: validEvccConfig(),
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: validEvccMetas(),
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, true);
        strict_1.default.equal(snap.liveEligible, true);
        strict_1.default.equal(snap.setMaxCurrentA?.semanticRole, "evcc_max_current");
        strict_1.default.equal(snap.setMode?.semanticRole, "evcc_mode");
        strict_1.default.equal(snap.controlPathReason, "evcc_control_path_confirmed");
    });
    (0, node_test_1.it)("minCurrent is not accepted as max current role", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: validEvccConfig({ wb_evcc_set_max_current_a_target: EVCC_MIN_CURRENT }),
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: {
                [EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
                [EVCC_MIN_CURRENT]: meta(EVCC_MIN_CURRENT, "number"),
            },
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
        strict_1.default.ok(snap.validationIssues.some((i) => i.includes("min_current_not_max_current")));
    });
    (0, node_test_1.it)("enabled is not accepted as mode role", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: validEvccConfig({ wb_evcc_set_mode_target: EVCC_ENABLED }),
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: {
                [EVCC_ENABLED]: meta(EVCC_ENABLED, "boolean"),
                [EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
            },
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
        strict_1.default.ok(snap.validationIssues.some((i) => i.includes("enabled_not_evcc_mode")));
    });
    (0, node_test_1.it)("common.write alone on evcc namespace does not confirm semantics", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: validEvccConfig({
                wb_evcc_set_max_current_a_target: "evcc.0.loadpoint.1.enabled",
            }),
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: {
                "evcc.0.loadpoint.1.enabled": meta("evcc.0.loadpoint.1.enabled", "boolean"),
                [EVCC_MODE]: meta(EVCC_MODE, "string", true, MODE_STATES),
            },
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
    });
    (0, node_test_1.it)("unknown charge mode value blocks confirmation", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: validEvccConfig({ wb_evcc_mode_charge_value: "unknown_mode" }),
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: validEvccMetas(),
        });
        strict_1.default.equal(snap.chargeModeValueConfirmed, false);
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
        strict_1.default.ok(snap.validationIssues.some((i) => i.includes("enum_value_not_allowed")));
    });
    (0, node_test_1.it)("go-e target is not confirmed as evcc path", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_control_model: "legacy_direct",
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_current_a_target: "go-e.0.amperePV",
            },
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
            objectMetas: {
                "go-e.0.allow_charging": meta("go-e.0.allow_charging", "boolean"),
                "go-e.0.amperePV": meta("go-e.0.amperePV", "number"),
            },
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
        strict_1.default.equal(snap.liveEligible, false);
        strict_1.default.equal(snap.controlPathReason, "legacy_direct_not_live_eligible");
    });
    (0, node_test_1.it)("legacy model is not live-eligible even when complete", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_control_model: "legacy_direct",
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_current_a_target: "go-e.0.amperePV",
            },
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
            objectMetas: {
                "go-e.0.allow_charging": meta("go-e.0.allow_charging", "boolean"),
                "go-e.0.amperePV": meta("go-e.0.amperePV", "number"),
            },
        });
        strict_1.default.equal(snap.liveEligible, false);
        strict_1.default.equal(snap.chargeControlRole, "set_current_a");
    });
    (0, node_test_1.it)("ambiguous same-target current and power mappings stay blocked", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_control_model: "legacy_direct",
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_current_a_target: "go-e.0.amperePV",
                wb_set_charge_power_w_target: "go-e.0.amperePV",
            },
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
            objectMetas: {},
        });
        strict_1.default.equal(snap.ambiguousPowerControl, true);
        strict_1.default.equal(snap.mappingConflictReason, "ambiguous_power_control_mapping");
    });
    (0, node_test_1.it)("non-writable evcc target blocks confirmation", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: validEvccConfig(),
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: validEvccMetas({
                [EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number", false),
            }),
        });
        strict_1.default.equal(snap.evccControlPathConfirmed, false);
        strict_1.default.ok(snap.validationIssues.some((i) => i.includes("target_not_writable")));
    });
    (0, node_test_1.it)("legacy config without explicit model defaults to none", () => {
        const snap = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_current_a_target: "go-e.0.amperePV",
            },
            telemetryCfg: { enabledStateId: "", maxCurrentAStateId: "", modeReadbackStateId: "" },
            objectMetas: {},
        });
        strict_1.default.equal(snap.controlModel, "none");
        strict_1.default.equal(snap.controlPathReason, "control_model_not_selected");
        strict_1.default.equal(snap.legacyMappingsPresent, true);
    });
});
