"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const feedback_tick_js_1 = require("./feedback_tick.js");
function expectation(over = {}) {
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
function contract(over = {}) {
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
function hostWithValues(values) {
    return {
        getForeignStateAsync: async (id) => {
            if (!(id in values))
                return null;
            return { val: values[id] };
        },
    };
}
(0, node_test_1.describe)("isWallboxFeedbackStatusTerminal", () => {
    (0, node_test_1.it)("treats matched/mismatch/timeout/invalid/not_required as terminal", () => {
        strict_1.default.equal((0, feedback_tick_js_1.isWallboxFeedbackStatusTerminal)("matched"), true);
        strict_1.default.equal((0, feedback_tick_js_1.isWallboxFeedbackStatusTerminal)("mismatch"), true);
        strict_1.default.equal((0, feedback_tick_js_1.isWallboxFeedbackStatusTerminal)("timeout"), true);
        strict_1.default.equal((0, feedback_tick_js_1.isWallboxFeedbackStatusTerminal)("invalid"), true);
        strict_1.default.equal((0, feedback_tick_js_1.isWallboxFeedbackStatusTerminal)("not_required"), true);
    });
    (0, node_test_1.it)("treats pending/unavailable as non-terminal", () => {
        strict_1.default.equal((0, feedback_tick_js_1.isWallboxFeedbackStatusTerminal)("pending"), false);
        strict_1.default.equal((0, feedback_tick_js_1.isWallboxFeedbackStatusTerminal)("unavailable"), false);
    });
});
(0, node_test_1.describe)("tickWallboxFeedback", () => {
    (0, node_test_1.it)("returns the contract unchanged when feedback is not required", async () => {
        const c = contract({ required: false, expectations: [] });
        const result = await (0, feedback_tick_js_1.tickWallboxFeedback)(hostWithValues({}), c, 1000, 2000);
        strict_1.default.deepEqual(result, c);
    });
    (0, node_test_1.it)("reads the readback state and evaluates a matching value", async () => {
        const c = contract();
        const host = hostWithValues({ "evcc.0.loadpoint.1.maxCurrent": 10 });
        const result = await (0, feedback_tick_js_1.tickWallboxFeedback)(host, c, 1000, 7000);
        strict_1.default.equal(result.status, "matched");
        strict_1.default.equal(result.expectations[0].comparisonStatus, "matched");
    });
    (0, node_test_1.it)("treats a mismatched value past settle time as mismatch", async () => {
        const c = contract();
        const host = hostWithValues({ "evcc.0.loadpoint.1.maxCurrent": 6 });
        const result = await (0, feedback_tick_js_1.tickWallboxFeedback)(host, c, 1000, 7000);
        strict_1.default.equal(result.status, "mismatch");
    });
    (0, node_test_1.it)("treats an unreadable/missing state as unavailable once settle time elapses", async () => {
        const c = contract();
        const host = hostWithValues({});
        const result = await (0, feedback_tick_js_1.tickWallboxFeedback)(host, c, 1000, 7000);
        strict_1.default.equal(result.status, "unavailable");
    });
    (0, node_test_1.it)("swallows getForeignStateAsync errors and still evaluates as unavailable", async () => {
        const c = contract();
        const host = {
            getForeignStateAsync: async () => {
                throw new Error("state not accessible");
            },
        };
        const result = await (0, feedback_tick_js_1.tickWallboxFeedback)(host, c, 1000, 7000);
        strict_1.default.equal(result.status, "unavailable");
    });
});
