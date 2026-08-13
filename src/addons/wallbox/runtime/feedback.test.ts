import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { WallboxControlObjectMeta } from "./control_object_meta.js";
import {
	buildWallboxFeedbackContract,
	countWallboxFeedbackExpectations,
	evaluateWallboxFeedback,
	normalizeWallboxFeedbackValue,
} from "./feedback.js";
import {
	WB_FEEDBACK_MAX_CURRENT_TOLERANCE_A,
	WB_FEEDBACK_SETTLE_MS_DEFAULT,
	WB_FEEDBACK_TIMEOUT_MS_DEFAULT,
	wallboxFeedbackConfigFromAdapter,
	validateWallboxFeedbackTiming,
} from "./feedback_config.js";
import type { WallboxWritePlan } from "./write_plan.js";

const NOW = new Date("2026-07-11T12:00:00.000Z");
const EVCC_MODE = "evcc.0.loadpoint.1.mode";
const EVCC_MAX = "evcc.0.loadpoint.1.maxCurrent";
const EVCC_MAX_RB = "evcc.0.telemetry.maxCurrent";
const GOE_AMP = "go-e.0.amperePV";
const GOE_EN = "go-e.0.allow_charging";

function feedbackConfig() {
	return {
		settleTimeMs: WB_FEEDBACK_SETTLE_MS_DEFAULT,
		timeoutMs: WB_FEEDBACK_TIMEOUT_MS_DEFAULT,
		maxCurrentToleranceA: WB_FEEDBACK_MAX_CURRENT_TOLERANCE_A,
	};
}

function evccChargeStartPlan(): WallboxWritePlan {
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

function legacyPlanWithCrossReadback(): WallboxWritePlan {
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

describe("wallbox feedback contract builder", () => {
	it("none produces not_required without expectations", () => {
		const c = buildWallboxFeedbackContract({
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
		assert.equal(c.required, false);
		assert.equal(c.ready, true);
		assert.equal(c.status, "not_required");
		assert.equal(c.expectations.length, 0);
	});

	it("charge_start creates maxCurrent and mode expectations", () => {
		const c = buildWallboxFeedbackContract({
			writePlan: evccChargeStartPlan(),
			feedbackConfig: feedbackConfig(),
			now: NOW,
		});
		assert.equal(c.ready, true);
		assert.equal(c.expectations.length, 2);
		assert.equal(c.expectations[0].role, "set_max_current_a");
		assert.equal(c.expectations[1].role, "set_mode");
		assert.equal(c.status, "unavailable");
		assert.equal(c.blockReason, "feedback_write_not_executed");
	});

	it("charge_adjust creates only maxCurrent expectation", () => {
		const plan = evccChargeStartPlan();
		plan.writeScenario = "charge_adjust";
		plan.operations = [plan.operations[0]];
		const c = buildWallboxFeedbackContract({ writePlan: plan, feedbackConfig: feedbackConfig(), now: NOW });
		assert.equal(c.expectations.length, 1);
		assert.equal(c.expectations[0].role, "set_max_current_a");
	});

	it("hold without mode operation is unavailable", () => {
		const c = buildWallboxFeedbackContract({
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
		assert.equal(c.status, "unavailable");
		assert.equal(c.blockReason, "hold_feedback_contract_unavailable");
	});

	it("missing required readback blocks structural ready", () => {
		const plan = evccChargeStartPlan();
		plan.operations[0].readbackStateId = null;
		const c = buildWallboxFeedbackContract({ writePlan: plan, feedbackConfig: feedbackConfig(), now: NOW });
		assert.equal(c.ready, false);
		assert.equal(c.blockReason, "feedback_readback_missing");
	});

	it("cross-controller legacy write and evcc readback is blocked", () => {
		const c = buildWallboxFeedbackContract({
			writePlan: legacyPlanWithCrossReadback(),
			feedbackConfig: feedbackConfig(),
			now: NOW,
		});
		assert.equal(c.ready, false);
		assert.equal(c.issueKind, "cross_controller");
		assert.equal(c.blockReason, "cross_controller_feedback_unsupported");
	});

	it("evcc write with go-e readback is blocked", () => {
		const plan = evccChargeStartPlan();
		plan.operations[0].readbackStateId = GOE_AMP;
		const c = buildWallboxFeedbackContract({ writePlan: plan, feedbackConfig: feedbackConfig(), now: NOW });
		assert.equal(c.ready, false);
		assert.equal(c.blockReason, "cross_controller_feedback_unsupported");
	});
});

describe("wallbox feedback normalization", () => {
	it("accepts finite number", () => {
		const r = normalizeWallboxFeedbackValue({ role: "set_max_current_a", rawValue: 16, expectedType: "number" });
		assert.equal(r.valid, true);
		if (r.valid) assert.equal(r.value, 16);
	});

	it("rejects NaN", () => {
		const r = normalizeWallboxFeedbackValue({ role: "set_max_current_a", rawValue: Number.NaN, expectedType: "number" });
		assert.equal(r.valid, false);
	});

	it("rejects Infinity", () => {
		const r = normalizeWallboxFeedbackValue({ role: "set_max_current_a", rawValue: Infinity, expectedType: "number" });
		assert.equal(r.valid, false);
	});

	it("rejects negative maxCurrent", () => {
		const r = normalizeWallboxFeedbackValue({ role: "set_max_current_a", rawValue: -1, expectedType: "number" });
		assert.equal(r.valid, false);
		if (!r.valid) assert.equal(r.reason, "feedback_current_negative");
	});

	it("rejects invalid string", () => {
		const r = normalizeWallboxFeedbackValue({ role: "set_mode", rawValue: "", expectedType: "string" });
		assert.equal(r.valid, false);
	});

	it("rejects unknown enum value", () => {
		const meta: WallboxControlObjectMeta = {
			stateId: EVCC_MODE,
			objectPresent: true,
			writable: true,
			readable: true,
			commonType: "string",
			allowedStateKeys: ["pv", "off"],
		};
		const r = normalizeWallboxFeedbackValue({
			role: "set_mode",
			rawValue: "now",
			expectedType: "string",
			objectMeta: meta,
		});
		assert.equal(r.valid, false);
		if (!r.valid) assert.equal(r.reason, "feedback_enum_value_invalid");
	});

	it("accepts boolean without implicit conversion", () => {
		const r = normalizeWallboxFeedbackValue({ role: "set_enabled", rawValue: true, expectedType: "boolean" });
		assert.equal(r.valid, true);
		const bad = normalizeWallboxFeedbackValue({ role: "set_enabled", rawValue: 1, expectedType: "boolean" });
		assert.equal(bad.valid, false);
	});
});

describe("wallbox feedback evaluation", () => {
	const baseContract = () =>
		buildWallboxFeedbackContract({
			writePlan: evccChargeStartPlan(),
			feedbackConfig: feedbackConfig(),
			now: NOW,
		});

	it("exact string match", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "pv" },
			evaluationTimeMs: writeTs + WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "matched");
	});

	it("string mismatch after settle", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "off" },
			evaluationTimeMs: writeTs + WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "mismatch");
	});

	it("number match within zero tolerance", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "pv" },
			evaluationTimeMs: writeTs + 100,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "matched");
	});

	it("number mismatch outside tolerance after settle", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 14, [EVCC_MODE]: "pv" },
			evaluationTimeMs: writeTs + WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "mismatch");
	});

	it("missing actual is unavailable before timeout", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 16 },
			evaluationTimeMs: writeTs + WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "unavailable");
	});

	it("timeout when readback stays missing", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 16 },
			evaluationTimeMs: writeTs + WB_FEEDBACK_TIMEOUT_MS_DEFAULT + 1,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "timeout");
	});

	it("invalid actual value", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: Number.NaN, [EVCC_MODE]: "pv" },
			evaluationTimeMs: writeTs + WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "invalid");
	});

	it("no false pending without write timestamp", () => {
		const contract = baseContract();
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "pv" },
			evaluationTimeMs: Date.now(),
			writeTimestampMs: null,
		});
		assert.notEqual(result.status, "pending");
		assert.notEqual(result.status, "matched");
		assert.equal(result.blockReason, "feedback_write_not_executed");
	});

	it("before settle time mismatch stays not evaluated then pending path", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 14, [EVCC_MODE]: "pv" },
			evaluationTimeMs: writeTs + 100,
			writeTimestampMs: writeTs,
		});
		assert.equal(result.status, "pending");
	});

	it("counts expectations by comparison status", () => {
		const contract = baseContract();
		const writeTs = 1_000_000;
		const result = evaluateWallboxFeedback({
			contract,
			actualValues: { [EVCC_MAX_RB]: 16, [EVCC_MODE]: "off" },
			evaluationTimeMs: writeTs + WB_FEEDBACK_SETTLE_MS_DEFAULT + 100,
			writeTimestampMs: writeTs,
		});
		const counts = countWallboxFeedbackExpectations(result.expectations);
		assert.equal(counts.matched, 1);
		assert.equal(counts.mismatch, 1);
	});
});

describe("wallbox feedback timing config", () => {
	it("defaults settle and timeout", () => {
		const cfg = wallboxFeedbackConfigFromAdapter({});
		assert.equal(cfg.settleTimeMs, WB_FEEDBACK_SETTLE_MS_DEFAULT);
		assert.equal(cfg.timeoutMs, WB_FEEDBACK_TIMEOUT_MS_DEFAULT);
		assert.ok(validateWallboxFeedbackTiming(cfg).valid);
	});

	it("invalid timing when timeout <= settle", () => {
		const invalid = validateWallboxFeedbackTiming({ settleTimeMs: 5000, timeoutMs: 5000, maxCurrentToleranceA: 0 });
		assert.equal(invalid.valid, false);
		assert.equal(invalid.reason, "invalid_feedback_timing");
	});
});

describe("wallbox feedback safety", () => {
	it("feedback module has no foreign writes or timers", () => {
		const src = readFileSync(join(process.cwd(), "src/addons/wallbox/runtime/feedback.ts"), "utf8");
		assert.ok(!src.includes("setForeignStateAsync"));
		assert.ok(!src.includes("writeForeignIfChanged"));
		assert.ok(!src.includes("setTimeout"));
		assert.ok(!src.includes("setInterval"));
	});

	it("execute module has no self-scheduling timers (safety tick lives in the orchestrator)", () => {
		const src = readFileSync(join(process.cwd(), "src/addons/wallbox/runtime/execute.ts"), "utf8");
		assert.ok(src.includes("WALLBOX_LIVE_WRITE_RELEASED = true"));
		assert.ok(!src.includes("setTimeout"));
		assert.ok(!src.includes("setInterval"));
	});
});
