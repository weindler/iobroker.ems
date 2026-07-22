import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isWallboxFeedbackStatusTerminal, tickWallboxFeedback, type WallboxFeedbackReadHost } from "./feedback_tick.js";
import type { WallboxFeedbackContract, WallboxFeedbackExpectation } from "./feedback.js";

function expectation(over: Partial<WallboxFeedbackExpectation> = {}): WallboxFeedbackExpectation {
	return {
		role: "set_max_current_a",
		writeTargetStateId: "evcc.0.loadpoint.1.maxCurrent",
		readbackStateId: "evcc.0.loadpoint.1.maxCurrent",
		expectedValue: 10,
		expectedValueType: "number",
		tolerance: 0,
		required: true,
		normalizedActualValue: null,
		comparisonStatus: "not_evaluated",
		mismatchReason: null,
		...over,
	};
}

function contract(over: Partial<WallboxFeedbackContract> = {}): WallboxFeedbackContract {
	return {
		required: true,
		ready: true,
		writePlanRevision: "rev-1",
		controlModel: "evcc",
		expectations: [expectation()],
		timeoutMs: 30000,
		settleTimeMs: 5000,
		status: "pending",
		issueKind: "none",
		blockReason: null,
		createdAt: "2026-07-20T10:00:00.000Z",
		...over,
	};
}

function hostWithValues(values: Record<string, unknown>): WallboxFeedbackReadHost {
	return {
		getForeignStateAsync: async (id: string) => {
			if (!(id in values)) return null;
			return { val: values[id] } as ioBroker.State;
		},
	};
}

describe("isWallboxFeedbackStatusTerminal", () => {
	it("treats matched/mismatch/timeout/invalid/not_required as terminal", () => {
		assert.equal(isWallboxFeedbackStatusTerminal("matched"), true);
		assert.equal(isWallboxFeedbackStatusTerminal("mismatch"), true);
		assert.equal(isWallboxFeedbackStatusTerminal("timeout"), true);
		assert.equal(isWallboxFeedbackStatusTerminal("invalid"), true);
		assert.equal(isWallboxFeedbackStatusTerminal("not_required"), true);
	});

	it("treats pending/unavailable as non-terminal", () => {
		assert.equal(isWallboxFeedbackStatusTerminal("pending"), false);
		assert.equal(isWallboxFeedbackStatusTerminal("unavailable"), false);
	});
});

describe("tickWallboxFeedback", () => {
	it("returns the contract unchanged when feedback is not required", async () => {
		const c = contract({ required: false, expectations: [] });
		const result = await tickWallboxFeedback(hostWithValues({}), c, 1000, 2000);
		assert.deepEqual(result, c);
	});

	it("reads the readback state and evaluates a matching value", async () => {
		const c = contract();
		const host = hostWithValues({ "evcc.0.loadpoint.1.maxCurrent": 10 });
		const result = await tickWallboxFeedback(host, c, 1000, 7000);
		assert.equal(result.status, "matched");
		assert.equal(result.expectations[0].comparisonStatus, "matched");
	});

	it("treats a mismatched value past settle time as mismatch", async () => {
		const c = contract();
		const host = hostWithValues({ "evcc.0.loadpoint.1.maxCurrent": 6 });
		const result = await tickWallboxFeedback(host, c, 1000, 7000);
		assert.equal(result.status, "mismatch");
	});

	it("treats an unreadable/missing state as unavailable once settle time elapses", async () => {
		const c = contract();
		const host = hostWithValues({});
		const result = await tickWallboxFeedback(host, c, 1000, 7000);
		assert.equal(result.status, "unavailable");
	});

	it("swallows getForeignStateAsync errors and still evaluates as unavailable", async () => {
		const c = contract();
		const host: WallboxFeedbackReadHost = {
			getForeignStateAsync: async () => {
				throw new Error("state not accessible");
			},
		};
		const result = await tickWallboxFeedback(host, c, 1000, 7000);
		assert.equal(result.status, "unavailable");
	});
});
