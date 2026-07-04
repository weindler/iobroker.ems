import { AC_WRITE_REFRESH_DELAY_MS, AC_WRITE_SETPOINT_DELAY_MS } from "../constants";
import type { AcUnitConfig, AcUnitModePurpose } from "../types";
import { modeStringsForPurpose, optionalStep, type AcProfile, type AcWriteStep } from "./types";

function samsungCoolingStart(unit: AcUnitConfig, purpose: AcUnitModePurpose): AcWriteStep[] {
	const { mode, fanMode, fanSpeed } = modeStringsForPurpose(unit, purpose);
	const steps: AcWriteStep[] = [
		// setAutoCleaningMode: gültige Werte on|speedClean|quietClean|timedClean|off — kein autoClean, kein Odor-Controller
		...optionalStep("cmd_cleaning_start", "off"),
		{ kind: "set", role: "cmd_set_cool_setpoint", value: unit.coolingSetpointC },
		{ kind: "delay_ms", ms: AC_WRITE_SETPOINT_DELAY_MS },
		{ kind: "set", role: "cmd_set_mode", value: mode },
		{ kind: "set", role: "cmd_set_fan_mode", value: fanMode },
		...optionalStep("cmd_set_fan_speed", fanSpeed),
		{ kind: "toggle", role: "cmd_switch_on" },
		{ kind: "delay_ms", ms: AC_WRITE_REFRESH_DELAY_MS },
		{ kind: "toggle", role: "cmd_refresh" },
	];
	return steps;
}

export const GENERIC_AC_PROFILE: AcProfile = {
	id: "generic",
	displayNameDe: "Generic (Mapping-basiert)",
	coolingStartSequence: (unit, purpose) => {
		const { mode, fanMode, fanSpeed } = modeStringsForPurpose(unit, purpose);
		return [
			{ kind: "set", role: "cmd_set_cool_setpoint", value: unit.coolingSetpointC },
			{ kind: "set", role: "cmd_set_mode", value: mode },
			{ kind: "set", role: "cmd_set_fan_mode", value: fanMode },
			...optionalStep("cmd_set_fan_speed", fanSpeed),
			{ kind: "toggle", role: "cmd_switch_on" },
		];
	},
	cleaningStartSequence: () => [
		{ kind: "set", role: "cmd_cleaning_start", value: "speedClean" },
	],
	cleaningStopSequence: () => [
		{ kind: "set", role: "cmd_cleaning_start", value: "off" },
		{ kind: "toggle", role: "cmd_refresh" },
	],
};

export const SAMSUNG_SMARTTHINGS_PROFILE: AcProfile = {
	id: "samsung_smartthings",
	displayNameDe: "Samsung SmartThings",
	coolingStartSequence: samsungCoolingStart,
	cleaningStartSequence: () => [
		{ kind: "toggle", role: "cmd_refresh" },
		{ kind: "set", role: "cmd_cleaning_start", value: "speedClean" },
	],
	cleaningStopSequence: () => [
		{ kind: "set", role: "cmd_cleaning_start", value: "off" },
		{ kind: "toggle", role: "cmd_refresh" },
	],
};

export const AC_PROFILES = [GENERIC_AC_PROFILE, SAMSUNG_SMARTTHINGS_PROFILE] as const;

export function getAcProfile(id: string): AcProfile {
	return AC_PROFILES.find((p) => p.id === id) ?? GENERIC_AC_PROFILE;
}
