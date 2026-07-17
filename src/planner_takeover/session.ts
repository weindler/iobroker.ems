import type { PlannerRuntimeMode } from "../planner_config";
import type { PlannerTakeoverEvaluationMode } from "../planner_config/evaluation_mode";
import type { StateHost } from "../ems_light/state_util";
import type { PlannerPathLayout } from "../planner_paths/paths";

export interface DualRunBridgeContext {
	layout: PlannerPathLayout;
	getPlannerRuntimeMode: () => PlannerRuntimeMode;
	getConfiguredEvaluationMode: () => PlannerTakeoverEvaluationMode;
	getStateHost: () => StateHost | null;
	isShuttingDown: () => boolean;
	getProtectedJobIds?: () => readonly string[];
}

interface DualRunSessionState {
	layout: PlannerPathLayout | null;
	plannerRuntimeMode: PlannerRuntimeMode;
	configuredEvaluationMode: PlannerTakeoverEvaluationMode;
	stateHost: StateHost | null;
	shuttingDown: boolean;
	protectedJobIds: string[];
}

const session: DualRunSessionState = {
	layout: null,
	plannerRuntimeMode: "off",
	configuredEvaluationMode: "disabled",
	stateHost: null,
	shuttingDown: false,
	protectedJobIds: [],
};

export function configureDualRunSession(partial: Partial<DualRunSessionState>): void {
	Object.assign(session, partial);
}

export function getDualRunBridgeContext(): DualRunBridgeContext | null {
	if (!session.layout) return null;
	return {
		layout: session.layout,
		getPlannerRuntimeMode: () => session.plannerRuntimeMode,
		getConfiguredEvaluationMode: () => session.configuredEvaluationMode,
		getStateHost: () => session.stateHost,
		isShuttingDown: () => session.shuttingDown,
		getProtectedJobIds: () => session.protectedJobIds,
	};
}

export function resetDualRunSessionForTest(): void {
	session.layout = null;
	session.plannerRuntimeMode = "off";
	session.configuredEvaluationMode = "disabled";
	session.stateHost = null;
	session.shuttingDown = false;
	session.protectedJobIds = [];
}
