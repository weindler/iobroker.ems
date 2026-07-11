import type { WallboxControlModel } from "../evcc_control_config";
import { classifyWallboxControlTargetKind } from "./control_object_meta";
import type { WallboxControlObjectMeta } from "./control_object_meta";
import type { WallboxFeedbackConfig } from "./feedback_config";
import { validateWallboxFeedbackTiming } from "./feedback_config";
import type { WallboxWritePlan, WallboxWriteValueType } from "./write_plan";

export type WallboxFeedbackStatus =
	| "not_required"
	| "unavailable"
	| "pending"
	| "matched"
	| "mismatch"
	| "timeout"
	| "invalid";

export type WallboxFeedbackComparisonStatus =
	| "not_evaluated"
	| "matched"
	| "mismatch"
	| "unavailable"
	| "invalid";

export type WallboxFeedbackIssueKind =
	| "none"
	| "mapping"
	| "unavailable"
	| "invalid_value"
	| "mismatch"
	| "timeout"
	| "cross_controller"
	| "unsupported";

export interface WallboxFeedbackExpectation {
	role: string;
	writeTargetStateId: string;
	readbackStateId: string;
	expectedValue: string | number | boolean;
	expectedValueType: WallboxWriteValueType;
	tolerance: number | null;
	required: boolean;
	normalizedActualValue: string | number | boolean | null;
	comparisonStatus: WallboxFeedbackComparisonStatus;
	mismatchReason: string | null;
}

export interface WallboxFeedbackContract {
	required: boolean;
	ready: boolean;
	writePlanRevision: string | null;
	controlModel: WallboxControlModel;
	expectations: WallboxFeedbackExpectation[];
	timeoutMs: number | null;
	settleTimeMs: number | null;
	status: WallboxFeedbackStatus;
	issueKind: WallboxFeedbackIssueKind;
	blockReason: string | null;
	createdAt: string;
}

export type NormalizedFeedbackValue =
	| { valid: true; value: string | number | boolean }
	| { valid: false; value: null; reason: string };

export interface NormalizeWallboxFeedbackValueInput {
	role: string;
	rawValue: unknown;
	expectedType: WallboxWriteValueType;
	objectMeta?: WallboxControlObjectMeta;
}

export interface BuildWallboxFeedbackContractInput {
	writePlan: WallboxWritePlan | null;
	feedbackConfig: WallboxFeedbackConfig;
	now: Date;
}

export interface EvaluateWallboxFeedbackInput {
	contract: WallboxFeedbackContract;
	actualValues: Record<string, unknown>;
	evaluationTimeMs: number;
	writeTimestampMs: number | null;
}

export interface WallboxFeedbackEvaluationCounts {
	matched: number;
	mismatch: number;
	unavailable: number;
	invalid: number;
	notEvaluated: number;
}

function issueKindForReason(reason: string | null): WallboxFeedbackIssueKind {
	if (!reason) return "none";
	if (reason.includes("cross_controller")) return "cross_controller";
	if (reason.includes("timeout")) return "timeout";
	if (reason.includes("mismatch")) return "mismatch";
	if (reason.includes("invalid")) return "invalid_value";
	if (reason.includes("readback_missing") || reason.includes("unavailable") || reason.includes("without_write")) {
		return "unavailable";
	}
	if (reason.includes("unsupported") || reason.includes("hold_feedback")) return "unsupported";
	if (reason.includes("mapping") || reason.includes("timing")) return "mapping";
	return "unsupported";
}

function isCrossControllerFeedback(writeTargetStateId: string, readbackStateId: string): boolean {
	const writeKind = classifyWallboxControlTargetKind(writeTargetStateId);
	const readKind = classifyWallboxControlTargetKind(readbackStateId);
	if (writeKind === readKind) return false;
	if (writeKind === "user_configured" || readKind === "user_configured") return false;
	return true;
}

function toleranceForRole(role: string, config: WallboxFeedbackConfig): number | null {
	if (role === "set_max_current_a" || role === "set_current_a") {
		return config.maxCurrentToleranceA;
	}
	return null;
}

function emptyContract(
	status: WallboxFeedbackStatus,
	issueKind: WallboxFeedbackIssueKind,
	blockReason: string | null,
	createdAt: string,
	controlModel: WallboxControlModel = "none",
): WallboxFeedbackContract {
	return {
		required: false,
		ready: false,
		writePlanRevision: null,
		controlModel,
		expectations: [],
		timeoutMs: null,
		settleTimeMs: null,
		status,
		issueKind,
		blockReason,
		createdAt,
	};
}

function expectationFromOperation(
	op: WallboxWritePlan["operations"][number],
	config: WallboxFeedbackConfig,
): { expectation: WallboxFeedbackExpectation | null; blockReason: string | null } {
	if (!op.readbackStateId) {
		return {
			expectation: null,
			blockReason: op.required ? "feedback_readback_missing" : null,
		};
	}
	if (op.expectedReadbackValue === null) {
		return {
			expectation: null,
			blockReason: op.required ? "feedback_expected_value_missing" : null,
		};
	}
	if (isCrossControllerFeedback(op.targetStateId, op.readbackStateId)) {
		return { expectation: null, blockReason: "cross_controller_feedback_unsupported" };
	}
	return {
		expectation: {
			role: op.role,
			writeTargetStateId: op.targetStateId,
			readbackStateId: op.readbackStateId,
			expectedValue: op.expectedReadbackValue,
			expectedValueType: op.targetValueType,
			tolerance: toleranceForRole(op.role, config),
			required: op.required,
			normalizedActualValue: null,
			comparisonStatus: "not_evaluated",
			mismatchReason: null,
		},
		blockReason: null,
	};
}

/**
 * Reine Ableitung — kein IO, keine Timer.
 */
export function buildWallboxFeedbackContract(input: BuildWallboxFeedbackContractInput): WallboxFeedbackContract {
	const { writePlan, feedbackConfig, now } = input;
	const createdAt = now.toISOString();

	if (!writePlan) {
		return emptyContract("unavailable", "unavailable", "write_plan_missing", createdAt);
	}

	const timing = validateWallboxFeedbackTiming(feedbackConfig);
	if (!timing.valid) {
		return {
			...emptyContract("unavailable", "mapping", timing.reason, createdAt, writePlan.controlModel),
			writePlanRevision: writePlan.commandRevision,
			required: writePlan.action !== "none",
		};
	}

	if (writePlan.action === "none") {
		if (writePlan.contractReady) {
			return {
				required: false,
				ready: true,
				writePlanRevision: writePlan.commandRevision,
				controlModel: writePlan.controlModel,
				expectations: [],
				timeoutMs: null,
				settleTimeMs: null,
				status: "not_required",
				issueKind: "none",
				blockReason: null,
				createdAt,
			};
		}
		return {
			...emptyContract("unavailable", "mapping", writePlan.blockReason ?? "write_contract_incomplete", createdAt, writePlan.controlModel),
			writePlanRevision: writePlan.commandRevision,
			required: false,
		};
	}

	if (writePlan.action === "hold") {
		const modeOps = writePlan.operations.filter((o) => o.role === "set_mode");
		if (modeOps.length === 0) {
			return {
				required: false,
				ready: false,
				writePlanRevision: writePlan.commandRevision,
				controlModel: writePlan.controlModel,
				expectations: [],
				timeoutMs: feedbackConfig.timeoutMs,
				settleTimeMs: feedbackConfig.settleTimeMs,
				status: "unavailable",
				issueKind: "unsupported",
				blockReason: "hold_feedback_contract_unavailable",
				createdAt,
			};
		}
	}

	if (!writePlan.contractReady) {
		return {
			...emptyContract("unavailable", "mapping", writePlan.blockReason ?? "write_contract_incomplete", createdAt, writePlan.controlModel),
			writePlanRevision: writePlan.commandRevision,
			required: true,
			timeoutMs: feedbackConfig.timeoutMs,
			settleTimeMs: feedbackConfig.settleTimeMs,
		};
	}

	const expectations: WallboxFeedbackExpectation[] = [];
	let blockReason: string | null = null;

	for (const op of writePlan.operations) {
		const built = expectationFromOperation(op, feedbackConfig);
		if (built.blockReason && op.required) {
			blockReason = blockReason ?? built.blockReason;
		}
		if (built.expectation) {
			expectations.push(built.expectation);
		}
	}

	const requiredExpectations = expectations.filter((e) => e.required);
	const ready =
		blockReason === null &&
		requiredExpectations.length > 0 &&
		requiredExpectations.every((e) => e.readbackStateId.length > 0);

	return {
		required: true,
		ready,
		writePlanRevision: writePlan.commandRevision,
		controlModel: writePlan.controlModel,
		expectations,
		timeoutMs: feedbackConfig.timeoutMs,
		settleTimeMs: feedbackConfig.settleTimeMs,
		status: ready ? "unavailable" : "unavailable",
		issueKind: issueKindForReason(blockReason),
		blockReason: ready ? "feedback_write_not_executed" : blockReason ?? "feedback_contract_incomplete",
		createdAt,
	};
}

export function normalizeWallboxFeedbackValue(input: NormalizeWallboxFeedbackValueInput): NormalizedFeedbackValue {
	const { role, rawValue, expectedType, objectMeta } = input;

	if (rawValue === null || rawValue === undefined) {
		return { valid: false, value: null, reason: "feedback_value_unavailable" };
	}

	if (expectedType === "boolean") {
		if (typeof rawValue !== "boolean") {
			return { valid: false, value: null, reason: "feedback_value_invalid" };
		}
		return { valid: true, value: rawValue };
	}

	if (expectedType === "string") {
		if (typeof rawValue !== "string") {
			return { valid: false, value: null, reason: "feedback_value_invalid" };
		}
		const value = rawValue.trim();
		if (!value) {
			return { valid: false, value: null, reason: "feedback_value_invalid" };
		}
		if (objectMeta?.allowedStateKeys && objectMeta.allowedStateKeys.length > 0) {
			if (!objectMeta.allowedStateKeys.includes(value)) {
				return { valid: false, value: null, reason: "feedback_enum_value_invalid" };
			}
		}
		return { valid: true, value };
	}

	if (expectedType === "number") {
		let n: number;
		if (typeof rawValue === "number") {
			n = rawValue;
		} else if (typeof rawValue === "string" && rawValue.trim() !== "") {
			n = parseFloat(rawValue.replace(",", ".").trim());
		} else {
			return { valid: false, value: null, reason: "feedback_value_invalid" };
		}
		if (!Number.isFinite(n)) {
			return { valid: false, value: null, reason: "feedback_value_invalid" };
		}
		if (role === "set_max_current_a" || role === "set_current_a") {
			if (n < 0) {
				return { valid: false, value: null, reason: "feedback_current_negative" };
			}
		}
		return { valid: true, value: n };
	}

	return { valid: false, value: null, reason: "feedback_value_invalid" };
}

function valuesMatch(
	expected: string | number | boolean,
	actual: string | number | boolean,
	expectedType: WallboxWriteValueType,
	tolerance: number | null,
): boolean {
	if (expectedType === "number" && typeof expected === "number" && typeof actual === "number") {
		const tol = tolerance ?? 0;
		return Math.abs(actual - expected) <= tol;
	}
	return actual === expected;
}

function evaluateExpectation(
	exp: WallboxFeedbackExpectation,
	rawActual: unknown,
	elapsedMs: number,
	settleTimeMs: number,
	timeoutMs: number,
	objectMeta?: WallboxControlObjectMeta,
): WallboxFeedbackExpectation {
	if (rawActual === undefined) {
		if (elapsedMs >= timeoutMs) {
			return {
				...exp,
				comparisonStatus: "unavailable",
				mismatchReason: "feedback_timeout",
			};
		}
		return {
			...exp,
			comparisonStatus: elapsedMs >= settleTimeMs ? "unavailable" : "not_evaluated",
			mismatchReason: elapsedMs >= settleTimeMs ? "feedback_readback_missing" : null,
		};
	}

	const normalized = normalizeWallboxFeedbackValue({
		role: exp.role,
		rawValue: rawActual,
		expectedType: exp.expectedValueType,
		objectMeta,
	});

	if (!normalized.valid) {
		return {
			...exp,
			normalizedActualValue: null,
			comparisonStatus: "invalid",
			mismatchReason: normalized.reason,
		};
	}

	const matched = valuesMatch(
		exp.expectedValue,
		normalized.value,
		exp.expectedValueType,
		exp.tolerance,
	);

	if (matched) {
		return {
			...exp,
			normalizedActualValue: normalized.value,
			comparisonStatus: "matched",
			mismatchReason: null,
		};
	}

	if (elapsedMs < settleTimeMs) {
		return {
			...exp,
			normalizedActualValue: normalized.value,
			comparisonStatus: "not_evaluated",
			mismatchReason: null,
		};
	}

	if (elapsedMs >= timeoutMs) {
		return {
			...exp,
			normalizedActualValue: normalized.value,
			comparisonStatus: "mismatch",
			mismatchReason: "feedback_timeout",
		};
	}

	return {
		...exp,
		normalizedActualValue: normalized.value,
		comparisonStatus: "mismatch",
		mismatchReason: "feedback_value_mismatch",
	};
}

function aggregateStatus(
	expectations: WallboxFeedbackExpectation[],
	required: boolean,
): { status: WallboxFeedbackStatus; issueKind: WallboxFeedbackIssueKind; blockReason: string | null } {
	if (!required || expectations.length === 0) {
		return { status: "not_required", issueKind: "none", blockReason: null };
	}

	const req = expectations.filter((e) => e.required);
	if (req.some((e) => e.comparisonStatus === "invalid")) {
		return { status: "invalid", issueKind: "invalid_value", blockReason: "feedback_value_invalid" };
	}
	if (req.some((e) => e.mismatchReason === "feedback_timeout")) {
		return { status: "timeout", issueKind: "timeout", blockReason: "feedback_timeout" };
	}
	if (req.every((e) => e.comparisonStatus === "matched")) {
		return { status: "matched", issueKind: "none", blockReason: null };
	}
	if (req.some((e) => e.comparisonStatus === "mismatch")) {
		return { status: "mismatch", issueKind: "mismatch", blockReason: "feedback_value_mismatch" };
	}
	if (req.some((e) => e.comparisonStatus === "unavailable")) {
		return { status: "unavailable", issueKind: "unavailable", blockReason: "feedback_readback_missing" };
	}
	if (req.some((e) => e.comparisonStatus === "not_evaluated")) {
		return { status: "pending", issueKind: "none", blockReason: null };
	}
	return { status: "unavailable", issueKind: "unavailable", blockReason: "feedback_contract_incomplete" };
}

/**
 * Reine Auswertung — kein IO, keine Timer.
 */
export function evaluateWallboxFeedback(input: EvaluateWallboxFeedbackInput): WallboxFeedbackContract {
	const { contract, actualValues, evaluationTimeMs, writeTimestampMs } = input;

	if (!contract.required || contract.expectations.length === 0) {
		return contract;
	}

	if (writeTimestampMs === null) {
		return {
			...contract,
			status: contract.ready ? "unavailable" : contract.status,
			issueKind: contract.ready ? "unavailable" : contract.issueKind,
			blockReason: contract.ready ? "feedback_write_not_executed" : contract.blockReason,
		};
	}

	const elapsedMs = Math.max(0, evaluationTimeMs - writeTimestampMs);
	const settleTimeMs = contract.settleTimeMs ?? 0;
	const timeoutMs = contract.timeoutMs ?? settleTimeMs + 1;

	const expectations = contract.expectations.map((exp) =>
		evaluateExpectation(
			exp,
			actualValues[exp.readbackStateId],
			elapsedMs,
			settleTimeMs,
			timeoutMs,
		),
	);

	const agg = aggregateStatus(expectations, contract.required);

	return {
		...contract,
		expectations,
		status: agg.status,
		issueKind: agg.issueKind,
		blockReason: agg.blockReason,
	};
}

export function countWallboxFeedbackExpectations(
	expectations: WallboxFeedbackExpectation[],
): WallboxFeedbackEvaluationCounts {
	const counts: WallboxFeedbackEvaluationCounts = {
		matched: 0,
		mismatch: 0,
		unavailable: 0,
		invalid: 0,
		notEvaluated: 0,
	};
	for (const e of expectations) {
		switch (e.comparisonStatus) {
			case "matched":
				counts.matched++;
				break;
			case "mismatch":
				counts.mismatch++;
				break;
			case "unavailable":
				counts.unavailable++;
				break;
			case "invalid":
				counts.invalid++;
				break;
			default:
				counts.notEvaluated++;
		}
	}
	return counts;
}
