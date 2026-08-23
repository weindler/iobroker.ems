/**
 * LocalThings/HASS: climate.state_boolean bleibt oft false, obwohl HVAC-Modus cool/heat/… ist.
 * Dann gilt climate.state (feedback_mode) als On/Off-Wahrheit.
 */

import { isLocalthingsHassProfile } from "../profiles/registry";
import type { AcUnitConfig } from "../types";
import type { AcMappingTable } from "./sequences";
import { resolveAcMappingTarget } from "./sequences";
import { switchIsOn } from "./time";

export function deriveHassClimateStateId(feedbackSwitchId: string): string {
	const id = String(feedbackSwitchId ?? "").trim();
	if (id.endsWith(".state_boolean")) {
		return `${id.slice(0, -".state_boolean".length)}.state`;
	}
	return "";
}

export function resolveAcDevicePowered(input: {
	switchRaw: unknown;
	modeRaw?: unknown;
	useModeFallback: boolean;
}): { on: boolean; effectiveRaw: unknown; via: "switch" | "mode" | "none" } {
	if (switchIsOn(input.switchRaw)) {
		return { on: true, effectiveRaw: input.switchRaw, via: "switch" };
	}
	if (input.useModeFallback && input.modeRaw !== undefined && input.modeRaw !== null) {
		const modeStr = String(input.modeRaw).trim();
		if (modeStr !== "" && switchIsOn(input.modeRaw)) {
			return { on: true, effectiveRaw: input.modeRaw, via: "mode" };
		}
		if (modeStr !== "") {
			return { on: false, effectiveRaw: input.modeRaw, via: "mode" };
		}
	}
	return { on: false, effectiveRaw: input.switchRaw, via: "none" };
}

export function resolveAcFeedbackModeTarget(
	table: AcMappingTable,
	unit: AcUnitConfig,
	feedbackSwitchId: string,
): string {
	if (!isLocalthingsHassProfile(unit.profileId)) {
		return "";
	}
	const mapped = resolveAcMappingTarget(table, unit.index, "feedback_mode");
	if (mapped) return mapped;
	return deriveHassClimateStateId(feedbackSwitchId);
}
