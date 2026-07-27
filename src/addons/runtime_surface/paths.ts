import type { GovernedAddonRegistryEntry } from "../governance/types";
import { GOVERNED_ADDON_REGISTRY } from "../governance/registry";

/** Runtime path prefix: addons.<runtimeId>.runtime.surface */
export function addonRuntimeSurfaceBase(runtimeAddonId: string): string {
	return `addons.${runtimeAddonId}.runtime.surface`;
}

export const RUNTIME_SURFACE_STATE_IDS = {
	decisionSource: "decision_source",
	decisionDetail: "decision_detail",
	decisionReason: "decision_reason",
	lastDecisionAt: "last_decision_at",
	plannerStatus: "planner_status",
	intentStatus: "intent_status",
	executionStatus: "execution_status",
	profileReady: "profile_ready",
	telemetryReady: "telemetry_ready",
	fault: "fault",
	lockout: "lockout",
} as const;

export type RuntimeSurfaceStateKey = keyof typeof RUNTIME_SURFACE_STATE_IDS;

export function addonRuntimeSurfaceState(
	runtimeAddonId: string,
	key: (typeof RUNTIME_SURFACE_STATE_IDS)[RuntimeSurfaceStateKey],
): string {
	return `${addonRuntimeSurfaceBase(runtimeAddonId)}.${key}`;
}

export function runtimeSurfaceStateMap(runtimeAddonId: string): Record<RuntimeSurfaceStateKey, string> {
	const base = addonRuntimeSurfaceBase(runtimeAddonId);
	return {
		decisionSource: `${base}.${RUNTIME_SURFACE_STATE_IDS.decisionSource}`,
		decisionDetail: `${base}.${RUNTIME_SURFACE_STATE_IDS.decisionDetail}`,
		decisionReason: `${base}.${RUNTIME_SURFACE_STATE_IDS.decisionReason}`,
		lastDecisionAt: `${base}.${RUNTIME_SURFACE_STATE_IDS.lastDecisionAt}`,
		plannerStatus: `${base}.${RUNTIME_SURFACE_STATE_IDS.plannerStatus}`,
		intentStatus: `${base}.${RUNTIME_SURFACE_STATE_IDS.intentStatus}`,
		executionStatus: `${base}.${RUNTIME_SURFACE_STATE_IDS.executionStatus}`,
		profileReady: `${base}.${RUNTIME_SURFACE_STATE_IDS.profileReady}`,
		telemetryReady: `${base}.${RUNTIME_SURFACE_STATE_IDS.telemetryReady}`,
		fault: `${base}.${RUNTIME_SURFACE_STATE_IDS.fault}`,
		lockout: `${base}.${RUNTIME_SURFACE_STATE_IDS.lockout}`,
	};
}

export function governedRuntimeSurfaceEntries(): readonly GovernedAddonRegistryEntry[] {
	return GOVERNED_ADDON_REGISTRY;
}
