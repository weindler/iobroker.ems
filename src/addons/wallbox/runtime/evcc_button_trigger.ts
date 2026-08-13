/**
 * Prepared one-shot EVCC mode-button trigger (v0.1.274).
 * Not wired into execute — live writes stay closed.
 */

import type { EvPhase1PreparedState } from "../ev_foundation/types";
import type { EvccModeButton, EvccFeedbackModeValue, EvccModeControlContract } from "../evcc_mode_control";

export const EVCC_BUTTON_FOR_PREPARED_STATE: Record<EvPhase1PreparedState, EvccModeButton> = {
	idle: "off",
	pv: "pv",
	minpv: "min",
	planned_now: "now",
};

export const EVCC_FEEDBACK_FOR_PREPARED_STATE: Record<EvPhase1PreparedState, EvccFeedbackModeValue> = {
	idle: "off",
	pv: "pv",
	minpv: "min",
	planned_now: "now",
};

export function normalizeEvccFeedbackMode(raw: string | null | undefined): EvccFeedbackModeValue | null {
	const mode = (raw ?? "").trim().toLowerCase();
	if (mode === "off") return "off";
	if (mode === "pv" || mode === "solar") return "pv";
	if (mode === "min" || mode === "minpv" || mode === "min+pv") return "min";
	if (mode === "now" || mode === "immediate") return "now";
	return null;
}

export interface PreparedEvccButtonTrigger {
	kind: "one_shot_true";
	button: EvccModeButton;
	targetStateId: string;
	value: true;
	expectedFeedbackMode: EvccFeedbackModeValue;
	feedbackStateId: string;
	/** Never poll the button with true. */
	periodic: false;
	/** Do not fabricate a false write-back. */
	writeFalseAfterTrigger: false;
	/** v0.1.274: catalog only. */
	liveReleased: false;
	reason: "desired_differs_from_feedback" | "already_at_feedback" | "contract_incomplete";
}

function buttonStateId(contract: EvccModeControlContract, button: EvccModeButton): string {
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
export function prepareEvccButtonTrigger(input: {
	contract: EvccModeControlContract;
	desiredPreparedState: EvPhase1PreparedState;
	feedbackMode: string | null;
}): PreparedEvccButtonTrigger | null {
	const { contract, desiredPreparedState, feedbackMode } = input;
	if (contract.resolvedVariant !== "buttons") return null;
	const button = EVCC_BUTTON_FOR_PREPARED_STATE[desiredPreparedState];
	const expectedFeedbackMode = EVCC_FEEDBACK_FOR_PREPARED_STATE[desiredPreparedState];
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
