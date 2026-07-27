import { setStateIfChanged } from "../../policy/core/state_write";
import type { StateHost } from "../../ems_light/state_util";
import { mapDecisionDetailToCanonical } from "./map_decision";
import { runtimeSurfaceStateMap } from "./paths";
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

/** Publish unified §10 surface — call at end of each addon tick (after detailed leaves). */
export async function publishAddonRuntimeSurface(
	host: StateHost,
	runtimeAddonId: string,
	input: AddonRuntimeSurfaceInput,
): Promise<AddonRuntimeSurfaceSnapshot> {
	const snap = buildAddonRuntimeSurfaceSnapshot(input);
	const ids = runtimeSurfaceStateMap(runtimeAddonId);
	await setStateIfChanged(host, ids.decisionSource, snap.decisionSource);
	await setStateIfChanged(host, ids.decisionDetail, snap.decisionDetail);
	await setStateIfChanged(host, ids.decisionReason, snap.decisionReason);
	await setStateIfChanged(host, ids.lastDecisionAt, snap.lastDecisionAt);
	await setStateIfChanged(host, ids.plannerStatus, snap.plannerStatus);
	await setStateIfChanged(host, ids.intentStatus, snap.intentStatus);
	await setStateIfChanged(host, ids.executionStatus, snap.executionStatus);
	await setStateIfChanged(host, ids.profileReady, snap.profileReady);
	await setStateIfChanged(host, ids.telemetryReady, snap.telemetryReady);
	await setStateIfChanged(host, ids.fault, snap.fault);
	await setStateIfChanged(host, ids.lockout, snap.lockout);
	return snap;
}
