/**
 * External charging-authority diagnosis from the neutral EV model.
 * Vendor state IDs never appear here.
 */

import type { EvExternalAuthorityState, EvModelV1 } from "../types";

export function externalControlExpected(model: EvModelV1): boolean {
	if (model.externalControlConfigured) return true;
	if (model.externalControlEnabled === true) return true;
	return model.externalControlType !== "none";
}

function hasActiveExternalSignal(model: EvModelV1): boolean {
	return (
		model.gridRewardsActive === true ||
		model.smartChargingActive === true ||
		model.externalControlActive === true
	);
}

function sourceUnavailable(model: EvModelV1): boolean {
	const q = model.externalSourceQuality;
	return q === "stale" || q === "invalid";
}

export function resolveExternalAuthorityState(model: EvModelV1): EvExternalAuthorityState {
	if (!externalControlExpected(model)) return "inactive";
	if (sourceUnavailable(model)) return "unavailable";
	const q = model.externalSourceQuality;
	if (q === "unknown" && !model.externalSourceHealthy && !hasActiveExternalSignal(model)) {
		return "unavailable";
	}
	if (q === "unconfigured" && model.externalControlType !== "none") {
		return "unavailable";
	}

	const plan = model.externalSmartPlanAvailable === true;
	const active = hasActiveExternalSignal(model);

	if (active && plan) return "active";
	if (active && !plan) return "active_without_plan";
	if (!active && plan) return "planned";
	if (q === "unknown") return "unknown";
	return "inactive";
}
