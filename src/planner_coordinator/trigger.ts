import { PLANNER_TRIGGER_PRIORITY } from "./constants";
import type { PlannerTriggerReason, PlannerTriggerRequest } from "./types";

export function mergeTriggerRequests(
	current: PlannerTriggerRequest | undefined,
	incoming: PlannerTriggerRequest,
): PlannerTriggerRequest {
	if (!current) {
		return {
			reason: incoming.reason,
			requestedAt: incoming.requestedAt,
			correlationId: incoming.correlationId,
			force: incoming.force === true,
		};
	}
	const currentPriority = PLANNER_TRIGGER_PRIORITY[current.reason];
	const incomingPriority = PLANNER_TRIGGER_PRIORITY[incoming.reason];
	const winner = incomingPriority >= currentPriority ? incoming : current;
	return {
		reason: winner.reason,
		requestedAt: incoming.requestedAt || current.requestedAt,
		correlationId: incoming.correlationId ?? current.correlationId,
		// Force is sticky: once true, later non-forced coalesced events must not clear it.
		force: Boolean(current.force || incoming.force),
	};
}

export function triggerToJobTrigger(reason: PlannerTriggerReason): "manual" | "scheduled" | "ai" | "startup_missing_plan" | "state_change" {
	switch (reason) {
		case "manual":
			return "manual";
		case "scheduled":
			return "scheduled";
		case "ai_request":
			return "ai";
		case "startup_recovery":
			return "startup_missing_plan";
		case "relevant_change":
			return "state_change";
		default:
			return "manual";
	}
}
