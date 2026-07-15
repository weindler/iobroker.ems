import { PLANNER_TRIGGER_PRIORITY } from "./constants";
import type { PlannerTriggerReason, PlannerTriggerRequest } from "./types";

export function mergeTriggerRequests(
	current: PlannerTriggerRequest | undefined,
	incoming: PlannerTriggerRequest,
): PlannerTriggerRequest {
	if (!current) {
		return { ...incoming };
	}
	const currentPriority = PLANNER_TRIGGER_PRIORITY[current.reason];
	const incomingPriority = PLANNER_TRIGGER_PRIORITY[incoming.reason];
	const winner = incomingPriority >= currentPriority ? incoming : current;
	return {
		reason: winner.reason,
		requestedAt: incoming.requestedAt,
		correlationId: incoming.correlationId ?? current.correlationId,
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
