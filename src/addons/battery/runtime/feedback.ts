import type { SonnenFeedbackTolerance } from "../config";

export type FeedbackOutcome = "pending" | "ok" | "timeout";

export interface ModeFeedbackInput {
	expectedMode: number;
	actualMode: number | null;
	elapsedMs: number;
	timeoutMs: number;
}

export function checkModeFeedback(input: ModeFeedbackInput): FeedbackOutcome {
	if (input.actualMode !== null && input.actualMode === input.expectedMode) {
		return "ok";
	}
	if (input.elapsedMs >= input.timeoutMs) {
		return "timeout";
	}
	return "pending";
}

export interface ChargeFeedbackInput {
	expectedW: number;
	actualChargingW: number | null;
	elapsedMs: number;
	timeoutMs: number;
	tolerance: SonnenFeedbackTolerance;
}

export function chargeWithinTolerance(
	expectedW: number,
	actualW: number,
	tolerance: SonnenFeedbackTolerance,
): boolean {
	const allowed = Math.max(tolerance.absoluteW, (Math.abs(expectedW) * tolerance.relativePct) / 100);
	return Math.abs(actualW - expectedW) <= allowed;
}

export function checkChargeFeedback(input: ChargeFeedbackInput): FeedbackOutcome {
	if (input.actualChargingW !== null && chargeWithinTolerance(input.expectedW, input.actualChargingW, input.tolerance)) {
		return "ok";
	}
	if (input.elapsedMs >= input.timeoutMs) {
		return "timeout";
	}
	return "pending";
}
