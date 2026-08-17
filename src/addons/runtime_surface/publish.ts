import type { StateHost } from "../../ems_light/state_util";
import { mapDecisionDetailToCanonical } from "./map_decision";
import type { AddonRuntimeSurfaceInput, AddonRuntimeSurfaceSnapshot } from "./types";

export function buildAddonRuntimeSurfaceSnapshot(
	input: AddonRuntimeSurfaceInput,
): AddonRuntimeSurfaceSnapshot {
	return {
		decisionSource: mapDecisionDetailToCanonical(input.decisionDetail),
		decisionDetail: input.decisionDetail || "safe_default",
		decisionReason: input.decisionReason || "",
		lastDecisionAt: input.nowIso,
		plannerStatus: input.plannerStatus,
		intentStatus: input.intentStatus,
		executionStatus: input.executionStatus,
		profileReady: input.profileReady === true,
		telemetryReady: input.telemetryReady === true,
		fault: input.fault === true,
		lockout: input.lockout === true,
	};
}

/** Snapshot intern — keine ioBroker-Spiegel unter runtime.surface.*. */
export async function publishAddonRuntimeSurface(
	_host: StateHost,
	_runtimeAddonId: string,
	input: AddonRuntimeSurfaceInput,
): Promise<AddonRuntimeSurfaceSnapshot> {
	return buildAddonRuntimeSurfaceSnapshot(input);
}
