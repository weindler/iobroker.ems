"use strict";
/**
 * Prepared one-shot EVCC mode-button trigger (v0.1.274).
 * Not wired into execute — live writes stay closed.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.prepareEvccButtonTrigger = exports.normalizeEvccFeedbackMode = exports.EVCC_FEEDBACK_FOR_PREPARED_STATE = exports.EVCC_BUTTON_FOR_PREPARED_STATE = void 0;
exports.EVCC_BUTTON_FOR_PREPARED_STATE = {
    idle: "off",
    pv: "pv",
    minpv: "min",
    planned_now: "now",
};
exports.EVCC_FEEDBACK_FOR_PREPARED_STATE = {
    idle: "off",
    pv: "pv",
    minpv: "min",
    planned_now: "now",
};
function normalizeEvccFeedbackMode(raw) {
    const mode = (raw ?? "").trim().toLowerCase();
    if (mode === "off")
        return "off";
    if (mode === "pv" || mode === "solar")
        return "pv";
    if (mode === "min" || mode === "minpv" || mode === "min+pv")
        return "min";
    if (mode === "now" || mode === "immediate")
        return "now";
    return null;
}
exports.normalizeEvccFeedbackMode = normalizeEvccFeedbackMode;
function buttonStateId(contract, button) {
    switch (button) {
        case "off":
            return contract.offStateId;
        case "pv":
            return contract.pvStateId;
        case "min":
            return contract.minStateId;
        case "now":
            return contract.nowStateId;
    }
}
/**
 * Prepare a later one-shot button write. Returns null when the contract cannot
 * describe a trigger. Does not execute, retry, or schedule writes.
 */
function prepareEvccButtonTrigger(input) {
    const { contract, desiredPreparedState, feedbackMode } = input;
    if (contract.resolvedVariant !== "buttons")
        return null;
    const button = exports.EVCC_BUTTON_FOR_PREPARED_STATE[desiredPreparedState];
    const expectedFeedbackMode = exports.EVCC_FEEDBACK_FOR_PREPARED_STATE[desiredPreparedState];
    const targetStateId = buttonStateId(contract, button);
    const feedbackStateId = contract.modeFeedbackStateId;
    if (!targetStateId || !feedbackStateId || !contract.buttonsReady) {
        return {
            kind: "one_shot_true",
            button,
            targetStateId,
            value: true,
            expectedFeedbackMode,
            feedbackStateId,
            periodic: false,
            writeFalseAfterTrigger: false,
            liveReleased: false,
            reason: "contract_incomplete",
        };
    }
    const current = normalizeEvccFeedbackMode(feedbackMode);
    return {
        kind: "one_shot_true",
        button,
        targetStateId,
        value: true,
        expectedFeedbackMode,
        feedbackStateId,
        periodic: false,
        writeFalseAfterTrigger: false,
        liveReleased: false,
        reason: current === expectedFeedbackMode ? "already_at_feedback" : "desired_differs_from_feedback",
    };
}
exports.prepareEvccButtonTrigger = prepareEvccButtonTrigger;
