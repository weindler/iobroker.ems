import type { PlannerCoordinatorState, PlannerCoordinatorStatus } from "./types";

export function createInitialCoordinatorStatus(
	enabled: boolean,
): PlannerCoordinatorStatus {
	return {
		state: enabled ? "idle" : "disabled",
		enabled,
		generation: 0,
		rerunPending: false,
	};
}

export function copyCoordinatorStatus(status: PlannerCoordinatorStatus): PlannerCoordinatorStatus {
	return structuredClone(status);
}

export function isTerminalCoordinatorState(state: PlannerCoordinatorState): boolean {
	return state === "stopped";
}
