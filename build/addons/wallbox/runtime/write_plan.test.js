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
function fullMapping() {
    return (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
        config: {
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_enabled_enabled: true,
            wb_set_enabled_allowed: "[true,false,0,1]",
            wb_set_current_a_target: "go-e.0.amperePV",
            wb_set_current_a_enabled: true,
        },
        telemetryCfg: { enabledStateId: "evcc.0.enabled", chargePowerWStateId: "" },
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
            now: NOW,
        });
        strict_1.default.equal(plan.action, "none");
        strict_1.default.equal(plan.operations.length, 0);
        strict_1.default.equal(plan.actionable, false);
        strict_1.default.equal(plan.contractReady, true);
    });
    (0, node_test_1.it)("hold does not guess EVCC stop semantics", () => {
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
            now: NOW,
        });
        strict_1.default.equal(plan.action, "hold");
        strict_1.default.equal(plan.operations.length, 0);
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.blockReason, "hold_mapping_undefined");
    });
    (0, node_test_1.it)("charge start places setpoint before enable", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, true);
        strict_1.default.equal(plan.writeScenario, "charge_start");
        strict_1.default.equal(plan.operations.length, 2);
        strict_1.default.equal(plan.operations[0].role, "set_current_a");
        strict_1.default.equal(plan.operations[0].sequence, write_plan_js_1.WALLBOX_WRITE_SEQUENCE.set_current_a);
        strict_1.default.equal(plan.operations[1].role, "set_enabled");
        strict_1.default.equal(plan.operations[1].sequence, write_plan_js_1.WALLBOX_WRITE_SEQUENCE.set_enabled);
        strict_1.default.ok(plan.operations[0].sequence < plan.operations[1].sequence);
    });
    (0, node_test_1.it)("no enable write is planned before a valid setpoint on charge start", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        const enableIdx = plan.operations.findIndex((o) => o.role === "set_enabled");
        const chargeIdx = plan.operations.findIndex((o) => o.role === "set_current_a");
        strict_1.default.ok(chargeIdx >= 0);
        strict_1.default.ok(enableIdx > chargeIdx);
    });
    (0, node_test_1.it)("ongoing charge adjust plans only setpoint without enable", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: true,
            now: NOW,
        });
        strict_1.default.equal(plan.writeScenario, "charge_adjust");
        strict_1.default.equal(plan.operations.length, 1);
        strict_1.default.equal(plan.operations[0].role, "set_current_a");
        strict_1.default.equal(plan.operations[0].targetValue, 16);
    });
    (0, node_test_1.it)("uses only configured state ids", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        for (const op of plan.operations) {
            strict_1.default.ok(op.targetStateId.startsWith("go-e."));
            strict_1.default.ok(!op.targetStateId.includes("hardcoded"));
        }
    });
    (0, node_test_1.it)("connected false produces no operations", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({ connected: false, blocked: true, blockReason: "vehicle_disconnected" }),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.operations.length, 0);
        strict_1.default.equal(plan.blockReason, "vehicle_disconnected");
    });
    (0, node_test_1.it)("soc 0 disconnected does not add soc error", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({
                connected: false,
                targetPowerW: 0,
                targetCurrentA: null,
                blocked: true,
                blockReason: "vehicle_disconnected",
            }),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.blockReason, "vehicle_disconnected");
    });
    (0, node_test_1.it)("blocked candidate produces no executable plan", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({ blocked: true, technicallyReady: false, blockReason: "mapping_incomplete" }),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.operations.length, 0);
    });
    (0, node_test_1.it)("missing enable role blocks contract", () => {
        const mapping = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: { wb_set_current_a_target: "go-e.0.a", wb_set_current_a_enabled: true },
            telemetryCfg: { enabledStateId: "", chargePowerWStateId: "" },
        });
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping,
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
    });
    (0, node_test_1.it)("ambiguous same-target power mapping blocks contract", () => {
        const mapping = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
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
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping,
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.blockReason, "ambiguous_power_control_mapping");
        strict_1.default.equal(plan.operations.length, 0);
    });
    (0, node_test_1.it)("rejects non-finite current", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({ targetCurrentA: Number.NaN }),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
        strict_1.default.equal(plan.blockReason, "invalid_target_current");
    });
    (0, node_test_1.it)("rejects negative power", () => {
        const mapping = (0, control_mapping_js_1.buildWallboxControlMappingSnapshot)({
            config: {
                wb_set_enabled_target: "go-e.0.allow_charging",
                wb_set_enabled_enabled: true,
                wb_set_charge_power_w_target: "go-e.0.p",
                wb_set_charge_power_w_enabled: true,
            },
            telemetryCfg: { enabledStateId: "", chargePowerWStateId: "evcc.0.p" },
        });
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate({ targetPowerW: -100, targetCurrentA: null }),
            mapping,
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, false);
    });
    (0, node_test_1.it)("readback from telemetry config for enable", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        const enableOp = plan.operations.find((o) => o.role === "set_enabled");
        strict_1.default.ok(enableOp);
        strict_1.default.equal(enableOp.readbackStateId, "evcc.0.enabled");
        strict_1.default.equal(enableOp.expectedReadbackValue, true);
    });
    (0, node_test_1.it)("feedback contract independent from write contract", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.contractReady, true);
        strict_1.default.equal(plan.feedbackContractReady, false);
    });
    (0, node_test_1.it)("direct go-e path is not marked EVCC-compatible", () => {
        const plan = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.equal(plan.evccControlPathConfirmed, false);
    });
    (0, node_test_1.it)("stable operation order", () => {
        const a = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        const b = (0, write_plan_js_1.buildWallboxWritePlan)({
            candidate: candidate(),
            mapping: fullMapping(),
            chargingEnabled: false,
            now: NOW,
        });
        strict_1.default.deepEqual(a.operations.map((o) => [o.sequence, o.role, o.targetValue]), b.operations.map((o) => [o.sequence, o.role, o.targetValue]));
    });
});
