"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const feedback_js_1 = require("./feedback.js");
const feedback_config_js_1 = require("./feedback_config.js");
const NOW = new Date("2026-07-11T12:00:00.000Z");
const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX = "evcc.0.loadpoint.1.maxCurrent";
const EVCC_MAX_RB = "evcc.0.telemetry.maxCurrent";
const GOE_AMP = "go-e.0.amperePV";
const GOE_EN = "go-e.0.allow_charging";
function feedbackConfig() {
    return {
        settleTimeMs: feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT,
        timeoutMs: feedback_config_js_1.WB_FEEDBACK_TIMEOUT_MS_DEFAULT,
        maxCurrentToleranceA: feedback_config_js_1.WB_FEEDBACK_MAX_CURRENT_TOLERANCE_A,
    };
}
function evccChargeStartPlan() {
    return {
        action: "charge",
        actionable: true,
        contractReady: true,
        feedbackContractReady: true,
        controlModel: "evcc",
        evccControlPathConfirmed: true,
        liveEligible: true,
        controlPathReason: "evcc_control_path_confirmed",
        writeScenario: "charge_start",
        operations: [
            {
                role: "set_max_current_a",
                targetStateId: EVCC_MAX,
                targetValue: 16,
                targetValueType: "number",
                sequence: 1,
                required: true,
                readbackStateId: EVCC_MAX_RB,
                expectedReadbackValue: 16,
                sourceField: "targetCurrentA",
            },
            {
                role: "set_mode",
                targetStateId: EVCC_MODE,
                targetValue: "pv",
                targetValueType: "string",
                sequence: 2,
                required: true,
                readbackStateId: EVCC_MODE,
                expectedReadbackValue: "pv",
                sourceField: "evccChargeModeValue",
            },
        ],
        missingRoles: [],
        unsupportedReasons: [],
        commandRevision: "7",
        createdAt: NOW.toISOString(),
        blocked: false,
        blockReason: null,
    };
}
function legacyPlanWithCrossReadback() {
    return {
        action: "charge",
        actionable: true,
        contractReady: true,
        feedbackContractReady: true,
        controlModel: "legacy_direct",
        evccControlPathConfirmed: false,
        liveEligible: false,
        controlPathReason: "legacy_direct_not_live_eligible",
        writeScenario: "charge_start",
        operations: [
            {
                role: "set_current_a",
                targetStateId: GOE_AMP,
                targetValue: 16,
                targetValueType: "number",
                sequence: 1,
                required: true,
                readbackStateId: EVCC_MAX_RB,
                expectedReadbackValue: 16,
                sourceField: "targetCurrentA",
            },
            {
                role: "set_enabled",
                targetStateId: GOE_EN,
                targetValue: true,
                targetValueType: "boolean",
                sequence: 2,
                required: true,
                readbackStateId: "evcc.0.loadpoint.1.enabled",
                expectedReadbackValue: true,
                sourceField: "enableCharging",
            },
        ],
        missingRoles: [],
        unsupportedReasons: [],
        commandRevision: "1",
        createdAt: NOW.toISOString(),
        blocked: false,
        blockReason: null,
    };
}
(0, node_test_1.describe)("wallbox feedback contract builder", () => {
    (0, node_test_1.it)("none produces not_required without expectations", () => {
        const c = (0, feedback_js_1.buildWallboxFeedbackContract)({
            writePlan: {
                action: "none",
                actionable: false,
                contractReady: true,
                feedbackContractReady: false,
                controlModel: "evcc",
                evccControlPathConfirmed: false,
                liveEligible: false,
                controlPathReason: null,
                writeScenario: null,
                operations: [],
                missingRoles: [],
                unsupportedReasons: [],
                commandRevision: null,
                createdAt: NOW.toISOString(),
                blocked: false,
                blockReason: null,
            },
            feedbackConfig: feedbackConfig(),
            now: NOW,
        });
        strict_1.default.equal(c.required, false);
        strict_1.default.equal(c.ready, true);
        strict_1.default.equal(c.status, "not_required");
        strict_1.default.equal(c.expectations.length, 0);
    });
    (0, node_test_1.it)("charge_start creates maxCurrent and mode expectations", () => {
        const c = (0, feedback_js_1.buildWallboxFeedbackContract)({
            writePlan: evccChargeStartPlan(),
            feedbackConfig: feedbackConfig(),
            now: NOW,
        });
        strict_1.default.equal(c.ready, true);
        strict_1.default.equal(c.expectations.length, 2);
        strict_1.default.equal(c.expectations[0].role, "set_max_current_a");
        strict_1.default.equal(c.expectations[1].role, "set_mode");
        strict_1.default.equal(c.status, "unavailable");
        strict_1.default.equal(c.blockReason, "feedback_write_not_executed");
    });
    (0, node_test_1.it)("charge_adjust creates only maxCurrent expectation", () => {
        const plan = evccChargeStartPlan();
        plan.writeScenario = "charge_adjust";
        plan.operations = [plan.operations[0]];
        const c = (0, feedback_js_1.buildWallboxFeedbackContract)({ writePlan: plan, feedbackConfig: feedbackConfig(), now: NOW });
        strict_1.default.equal(c.expectations.length, 1);
        strict_1.default.equal(c.expectations[0].role, "set_max_current_a");
    });
    (0, node_test_1.it)("hold without mode operation is unavailable", () => {
        const c = (0, feedback_js_1.buildWallboxFeedbackContract)({
            writePlan: {
                action: "hold",
                actionable: false,
                contractReady: false,
                feedbackContractReady: false,
                controlModel: "evcc",
                evccControlPathConfirmed: false,
                liveEligible: false,
                controlPathReason: null,
                writeScenario: null,
                operations: [],
                missingRoles: [],
                unsupportedReasons: [],
                commandRevision: "1",
                createdAt: NOW.toISOString(),
                blocked: true,
                blockReason: "hold_mapping_undefined",
            },
            feedbackConfig: feedbackConfig(),
            now: NOW,
        });
        strict_1.default.equal(c.status, "unavailable");
        strict_1.default.equal(c.blockReason, "hold_feedback_contract_unavailable");
    });
    (0, node_test_1.it)("missing required readback blocks structural ready", () => {
        const plan = evccChargeStartPlan();
        plan.operations[0].readbackStateId = null;
        const c = (0, feedback_js_1.buildWallboxFeedbackContract)({ writePlan: plan, feedbackConfig: feedbackConfig(), now: NOW });
        strict_1.default.equal(c.ready, false);
        strict_1.default.equal(c.blockReason, "feedback_readback_missing");
    });
    (0, node_test_1.it)("cross-controller legacy write and evcc readback is blocked", () => {
        const c = (0, feedback_js_1.buildWallboxFeedbackContract)({
            writePlan: legacyPlanWithCrossReadback(),
            feedbackConfig: feedbackConfig(),
            now: NOW,
        });
        strict_1.default.equal(c.ready, false);
        strict_1.default.equal(c.issueKind, "cross_controller");
        strict_1.default.equal(c.blockReason, "cross_controller_feedback_unsupported");
    });
    (0, node_test_1.it)("evcc write with go-e readback is blocked", () => {
        const plan = evccChargeStartPlan();
        plan.operations[0].readbackStateId = GOE_AMP;
        const c = (0, feedback_js_1.buildWallboxFeedbackContract)({ writePlan: plan, feedbackConfig: feedbackConfig(), now: NOW });
        strict_1.default.equal(c.ready, false);
        strict_1.default.equal(c.blockReason, "cross_controller_feedback_unsupported");
    });
});
(0, node_test_1.describe)("wallbox feedback normalization", () => {
    (0, node_test_1.it)("accepts finite number", () => {
        const r = (0, feedback_js_1.normalizeWallboxFeedbackValue)({ role: "set_max_current_a", rawValue: 16, expectedType: "number" });
        strict_1.default.equal(r.valid, true);
        if (r.valid)
            strict_1.default.equal(r.value, 16);
    });
    (0, node_test_1.it)("rejects NaN", () => {
        const r = (0, feedback_js_1.normalizeWallboxFeedbackValue)({ role: "set_max_current_a", rawValue: Number.NaN, expectedType: "number" });
        strict_1.default.equal(r.valid, false);
    });
    (0, node_test_1.it)("rejects Infinity", () => {
        const r = (0, feedback_js_1.normalizeWallboxFeedbackValue)({ role: "set_max_current_a", rawValue: Infinity, expectedType: "number" });
        strict_1.default.equal(r.valid, false);
    });
    (0, node_test_1.it)("rejects negative maxCurrent", () => {
        const r = (0, feedback_js_1.normalizeWallboxFeedbackValue)({ role: "set_max_current_a", rawValue: -1, expectedType: "number" });
        strict_1.default.equal(r.valid, false);
        if (!r.valid)
            strict_1.default.equal(r.reason, "feedback_current_negative");
    });
    (0, node_test_1.it)("rejects invalid string", () => {
        const r = (0, feedback_js_1.normalizeWallboxFeedbackValue)({ role: "set_mode", rawValue: "", expectedType: "string" });
        strict_1.default.equal(r.valid, false);
    });
    (0, node_test_1.it)("rejects unknown enum value", () => {
        const meta = {
            stateId: EVCC_MODE,
            objectPresent: true,
            writable: true,
            readable: true,
            commonType: "string",
            allowedStateKeys: ["pv", "off"],
        };
        const r = (0, feedback_js_1.normalizeWallboxFeedbackValue)({
            role: "set_mode",
            rawValue: "now",
            expectedType: "string",
            objectMeta: meta,
        });
        strict_1.default.equal(r.valid, false);
        if (!r.valid)
            strict_1.default.equal(r.reason, "feedback_enum_value_invalid");
    });
    (0, node_test_1.it)("accepts boolean without implicit conversion", () => {
        const r = (0, feedback_js_1.normalizeWallboxFeedbackValue)({ role: "set_enabled", rawValue: true, expectedType: "boolean" });
        strict_1.default.equal(r.valid, true);
        const bad = (0, feedback_js_1.normalizeWallboxFeedbackValue)({ role: "set_enabled", rawValue: 1, expectedType: "boolean" });
        strict_1.default.equal(bad.valid, false);
    });
});
(0, node_test_1.describe)("wallbox feedback evaluation", () => {
    const baseContract = () => (0, feedback_js_1.buildWallboxFeedbackContract)({
        writePlan: evccChargeStartPlan(),
        feedbackConfig: feedbackConfig(),
        now: NOW,
    });
    (0, node_test_1.it)("exact string match", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "pv" },
            evaluationTimeMs: writeTs + feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "matched");
    });
    (0, node_test_1.it)("string mismatch after settle", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "off" },
            evaluationTimeMs: writeTs + feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "mismatch");
    });
    (0, node_test_1.it)("number match within zero tolerance", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "pv" },
            evaluationTimeMs: writeTs + 100,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "matched");
    });
    (0, node_test_1.it)("number mismatch outside tolerance after settle", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 14, [EVCC_MODE]: "pv" },
            evaluationTimeMs: writeTs + feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "mismatch");
    });
    (0, node_test_1.it)("missing actual is unavailable before timeout", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 16 },
            evaluationTimeMs: writeTs + feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "unavailable");
    });
    (0, node_test_1.it)("timeout when readback stays missing", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 16 },
            evaluationTimeMs: writeTs + feedback_config_js_1.WB_FEEDBACK_TIMEOUT_MS_DEFAULT + 1,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "timeout");
    });
    (0, node_test_1.it)("invalid actual value", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: Number.NaN, [EVCC_MODE]: "pv" },
            evaluationTimeMs: writeTs + feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "invalid");
    });
    (0, node_test_1.it)("no false pending without write timestamp", () => {
        const contract = baseContract();
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "pv" },
            evaluationTimeMs: Date.now(),
            writeTimestampMs: null,
        });
        strict_1.default.notEqual(result.status, "pending");
        strict_1.default.notEqual(result.status, "matched");
        strict_1.default.equal(result.blockReason, "feedback_write_not_executed");
    });
    (0, node_test_1.it)("before settle time mismatch stays not evaluated then pending path", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 14, [EVCC_MODE]: "pv" },
            evaluationTimeMs: writeTs + 100,
            writeTimestampMs: writeTs,
        });
        strict_1.default.equal(result.status, "pending");
    });
    (0, node_test_1.it)("counts expectations by comparison status", () => {
        const contract = baseContract();
        const writeTs = 1_000_000;
        const result = (0, feedback_js_1.evaluateWallboxFeedback)({
            contract,
            actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "off" },
            evaluationTimeMs: writeTs + feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
            writeTimestampMs: writeTs,
        });
        const counts = (0, feedback_js_1.countWallboxFeedbackExpectations)(result.expectations);
        strict_1.default.equal(counts.matched, 1);
        strict_1.default.equal(counts.mismatch, 1);
    });
});
(0, node_test_1.describe)("wallbox feedback timing config", () => {
    (0, node_test_1.it)("defaults settle and timeout", () => {
        const cfg = (0, feedback_config_js_1.wallboxFeedbackConfigFromAdapter)({});
        strict_1.default.equal(cfg.settleTimeMs, feedback_config_js_1.WB_FEEDBACK_SETTLE_MS_DEFAULT);
        strict_1.default.equal(cfg.timeoutMs, feedback_config_js_1.WB_FEEDBACK_TIMEOUT_MS_DEFAULT);
        strict_1.default.ok((0, feedback_config_js_1.validateWallboxFeedbackTiming)(cfg).valid);
    });
    (0, node_test_1.it)("invalid timing when timeout <= settle", () => {
        const invalid = (0, feedback_config_js_1.validateWallboxFeedbackTiming)({ settleTimeMs: 5000, timeoutMs: 5000, maxCurrentToleranceA: 0 });
        strict_1.default.equal(invalid.valid, false);
        strict_1.default.equal(invalid.reason, "invalid_feedback_timing");
    });
});
(0, node_test_1.describe)("wallbox feedback safety", () => {
    (0, node_test_1.it)("feedback module has no foreign writes or timers", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "src/addons/wallbox/runtime/feedback.ts"), "utf8");
        strict_1.default.ok(!src.includes("setForeignStateAsync"));
        strict_1.default.ok(!src.includes("writeForeignIfChanged"));
        strict_1.default.ok(!src.includes("setTimeout"));
        strict_1.default.ok(!src.includes("setInterval"));
    });
    (0, node_test_1.it)("execute module has no self-scheduling timers (safety tick lives in the orchestrator)", () => {
        const src = (0, node_fs_1.readFileSync)((0, node_path_1.join)(process.cwd(), "src/addons/wallbox/runtime/execute.ts"), "utf8");
        strict_1.default.ok(src.includes("WALLBOX_LIVE_WRITE_RELEASED = true"));
        strict_1.default.ok(!src.includes("setTimeout"));
        strict_1.default.ok(!src.includes("setInterval"));
    });
});
