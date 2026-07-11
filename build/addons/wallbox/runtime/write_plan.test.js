"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const control_mapping_js_1 = require("./control_mapping.js");
const write_plan_js_1 = require("./write_plan.js");
const NOW = new Date("2026-07-11T10:07:00.000Z");
function meta(id, commonType, allowedStateKeys = null) {
    return {
        stateId: id,
        objectPresent: true,
        writable: true,
        commonType,
        allowedStateKeys,
    };
}
const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX_CURRENT = "evcc.0.loadpoint.1.maxCurrent";
const MODE_STATES = ["pv", "off", "now"];
function legacyTelemetryCfg() {
    return {
        enabledStateId: "evcc.0.enabled",
        maxCurrentAStateId: "",
        modeReadbackStateId: "",
    };
}
function evccTelemetryCfg() {
    return {
        enabledStateId: "evcc.0.loadpoint.1.enabled",
        maxCurrentAStateId: "evcc.0.telemetry.maxCurrent",
        modeReadbackStateId: EVCC_MODE,
    };
}
function fullMapping() {
    return (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
        config: {
            wb_control_model: "legacy_direct",
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_enabled_enabled: true,
            wb_set_enabled_allowed: "[true,false,0,1]",
            wb_set_current_a_target: "go-e.0.amperePV",
            wb_set_current_a_enabled: true,
        },
        telemetryCfg: legacyTelemetryCfg(),
        objectMetas: {
            "go-e.0.allow_charging": meta("go-e.0.allow_charging", "boolean"),
            "go-e.0.amperePV": meta("go-e.0.amperePV", "number"),
        },
    });
}
function evccMapping() {
    return (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
        config: {
            wb_control_model: "evcc",
            wb_evcc_set_mode_target: EVCC_MODE,
            wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
            wb_evcc_mode_charge_value: "pv",
            wb_evcc_mode_hold_value: "off",
        },
        telemetryCfg: evccTelemetryCfg(),
        objectMetas: {
            [EVCC_MODE]: meta(EVCC_MODE, "string", MODE_STATES),
            [EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
        },
    });
}
function candidate(over = {}) {
    return {
        action: "charge",
        targetPowerW: 3600,
        targetCurrentA: 16,
        energySource: "grid",
        connected: true,
        technicallyReady: true,
        dispatchRevision: 3,
        planRevision: 3,
        createdAt: NOW.toISOString(),
        blocked: false,
        blockReason: null,
        ...over,
    };
}
(0, node_test_1.describe)("wallbox write plan", () => {
    (0, node_test_1.it)("none produces valid empty noop plan", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({ action: "none", blocked: true, blockReason: "dispatch_none" }),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.action, "none");
        strict_1.default.equal(plan.operations.length, 0);
        strict_1.default.equal(plan.actionable, false);
        strict_1.default.equal(plan.contractReady, true);
    });
    (0, node_test_1.it)("hold does not guess EVCC stop semantics without hold mapping", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({
                action: "hold",
                targetPowerW: 0,
                targetCurrentA: null,
                blocked: true,
                blockReason: "hold_requested",
                technicallyReady: true,
            }),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.action, "hold");
        strict_1.default.equal(plan.operations.length, 0);
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.blockReason, "hold_mapping_undefined");
    });
    (0, node_test_1.it)("legacy charge start places setpoint before enable", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, true);
        strict_1.default.equal(plan.writeScenario, "charge_start");
        strict_1.default.equal(plan.operations.length, 2);
        strict_1.default.equal(plan.operations[0].role, "set_current_a");
        strict_1.default.equal(plan.operations[0].sequence, write_plan_js_1.WALLBOX_LEGACY_WRITE_SEQUENCE.set_current_a);
        strict_1.default.equal(plan.operations[1].role, "set_enabled");
        strict_1.default.equal(plan.operations[1].sequence, write_plan_js_1.WALLBOX_LEGACY_WRITE_SEQUENCE.set_enabled);
        strict_1.default.ok(plan.operations[0].sequence < plan.operations[1].sequence);
    });
    (0, node_test_1.it)("legacy ongoing charge adjust plans only setpoint without enable", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: true,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.writeScenario, "charge_adjust");
        strict_1.default.equal(plan.operations.length, 1);
        strict_1.default.equal(plan.operations[0].role, "set_current_a");
        strict_1.default.equal(plan.operations[0].targetValue, 16);
    });
    (0, node_test_1.it)("evcc charge start places maxCurrent before mode", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: evccMapping(),
            chargingEnabled: false,
            chargeModeActive: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, true);
        strict_1.default.equal(plan.writeScenario, "charge_start");
        strict_1.default.equal(plan.operations.length, 2);
        strict_1.default.equal(plan.operations[0].role, "set_max_current_a");
        strict_1.default.equal(plan.operations[0].sequence, write_plan_js_1.WALLBOX_EVCC_WRITE_SEQUENCE.set_max_current_a);
        strict_1.default.equal(plan.operations[1].role, "set_mode");
        strict_1.default.equal(plan.operations[1].sequence, write_plan_js_1.WALLBOX_EVCC_WRITE_SEQUENCE.set_mode);
        strict_1.default.equal(plan.operations[0].targetStateId, EVCC_MAX_CURRENT);
        strict_1.default.equal(plan.operations[1].targetValue, "pv");
    });
    (0, node_test_1.it)("evcc ongoing adjust plans only maxCurrent when charge mode active", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: evccMapping(),
            chargingEnabled: true,
            chargeModeActive: true,
            now: NOW,
        });
        strict_1.default.equal(plan.writeScenario, "charge_adjust");
        strict_1.default.equal(plan.operations.length, 1);
        strict_1.default.equal(plan.operations[0].role, "set_max_current_a");
        strict_1.default.ok(!plan.operations.some((o) => o.role === "set_enabled"));
        strict_1.default.ok(!plan.operations.some((o) => o.role === "set_mode"));
    });
    (0, node_test_1.it)("evcc does not use minCurrent target", () => {
        const mapping = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_control_model: "evcc",
                wb_evcc_set_mode_target: EVCC_MODE,
                wb_evcc_set_max_current_a_target: "evcc.0.loadpoint.1.minCurrent",
                wb_evcc_mode_charge_value: "pv",
            },
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: {
                [EVCC_MODE]: meta(EVCC_MODE, "string", MODE_STATES),
                "evcc.0.loadpoint.1.minCurrent": meta("evcc.0.loadpoint.1.minCurrent", "number"),
            },
        });
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping,
            chargingEnabled: false,
            chargeModeActive: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.operations.length, 0);
    });
    (0, node_test_1.it)("missing charge mode mapping blocks evcc charge_start", () => {
        const mapping = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_control_model: "evcc",
                wb_evcc_set_mode_target: EVCC_MODE,
                wb_evcc_set_max_current_a_target: EVCC_MAX_CURRENT,
            },
            telemetryCfg: evccTelemetryCfg(),
            objectMetas: {
                [EVCC_MODE]: meta(EVCC_MODE, "string", MODE_STATES),
                [EVCC_MAX_CURRENT]: meta(EVCC_MAX_CURRENT, "number"),
            },
        });
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping,
            chargingEnabled: false,
            chargeModeActive: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.blockReason, "evcc_charge_mode_mapping_missing");
    });
    (0, node_test_1.it)("uses only configured state ids", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        for (const op of plan.operations) {
            strict_1.default.ok(op.targetStateId.startsWith("go-e."));
        }
    });
    (0, node_test_1.it)("connected false produces no operations", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({ connected: false, blocked: true, blockReason: "vehicle_disconnected" }),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.operations.length, 0);
        strict_1.default.equal(plan.blockReason, "vehicle_disconnected");
    });
    (0, node_test_1.it)("blocked candidate produces no executable plan", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({ blocked: true, technicallyReady: false, blockReason: "mapping_incomplete" }),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.operations.length, 0);
    });
    (0, node_test_1.it)("ambiguous same-target power mapping blocks contract", () => {
        const mapping = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_control_model: "legacy_direct",
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_enabled_enabled: true,
                wb_set_current_a_target: "go-e.0.amperePV",
                wb_set_current_a_enabled: true,
                wb_set_charge_power_w_target: "go-e.0.amperePV",
                wb_set_charge_power_w_enabled: true,
            },
            telemetryCfg: legacyTelemetryCfg(),
            objectMetas: {},
        });
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping,
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.blockReason, "ambiguous_power_control_mapping");
    });
    (0, node_test_1.it)("evcc readback uses maxCurrent and mode not enabled", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: evccMapping(),
            chargingEnabled: false,
            chargeModeActive: false,
            now: NOW,
        });
        const maxOp = plan.operations.find((o) => o.role === "set_max_current_a");
        const modeOp = plan.operations.find((o) => o.role === "set_mode");
        strict_1.default.ok(maxOp);
        strict_1.default.ok(modeOp);
        strict_1.default.equal(maxOp.readbackStateId, "evcc.0.telemetry.maxCurrent");
        strict_1.default.equal(modeOp.readbackStateId, EVCC_MODE);
        strict_1.default.ok(!plan.operations.some((o) => o.readbackStateId?.includes("enabled")));
    });
    (0, node_test_1.it)("direct go-e path is not live-eligible", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.evccControlPathConfirmed, false);
        strict_1.default.equal(plan.liveEligible, false);
    });
    (0, node_test_1.it)("evcc path can be live-eligible structurally", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: evccMapping(),
            chargingEnabled: false,
            chargeModeActive: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, true);
        strict_1.default.equal(plan.evccControlPathConfirmed, true);
        strict_1.default.equal(plan.liveEligible, true);
    });
    (0, node_test_1.it)("feedback contract requires readback states", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: evccMapping(),
            chargingEnabled: false,
            chargeModeActive: false,
            now: NOW,
        });
        strict_1.default.equal(plan.feedbackContractReady, true);
    });
    (0, node_test_1.it)("legacy feedback contract independent when current has no readback", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            chargeModeActive: null,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, true);
        strict_1.default.equal(plan.feedbackContractReady, false);
    });
});
