import type { PlannerTriggerReason } from "./types";

/** Higher number wins when coalescing concurrent trigger requests. */
export const PLANNER_TRIGGER_PRIORITY: Record<PlannerTriggerReason, number> = {
	manual: 50,
	ai_request: 50,
	startup_recovery: 40,
	scheduled: 30,
	relevant_change: 20,
	test: 10,
};

export const PLANNER_COORDINATOR_DEFAULT_TIMEOUT_MS = 120_000;

export const PLANNER_COORDINATOR_SHUTDOWN_TIMEOUT_MS = 10_000;
