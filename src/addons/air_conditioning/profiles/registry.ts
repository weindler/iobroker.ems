import { AC_WRITE_REFRESH_DELAY_MS, AC_WRITE_SETPOINT_DELAY_MS } from "../constants";
import type { AcUnitConfig, AcUnitModePurpose } from "../types";
import {
	localthingsFanModePayload,
	localthingsHvacModePayload,
	localthingsTemperaturePayload,
} from "./localthings_payload";
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

function localthingsCoolingStart(unit: AcUnitConfig, purpose: AcUnitModePurpose): AcWriteStep[] {
	const { mode, fanMode } = modeStringsForPurpose(unit, purpose);
	const steps: AcWriteStep[] = [
		{
			kind: "set_json",
			role: "cmd_set_cool_setpoint",
			payload: localthingsTemperaturePayload(unit.coolingSetpointC),
		},
		{ kind: "delay_ms", ms: AC_WRITE_SETPOINT_DELAY_MS },
		{
			kind: "set_json",
			role: "cmd_set_mode",
			payload: localthingsHvacModePayload(mode),
		},
	];
	if (fanMode.trim()) {
		steps.push({
			kind: "set_json",
			role: "cmd_set_fan_mode",
			payload: localthingsFanModePayload(fanMode),
		});
	}
	steps.push({ kind: "toggle", role: "cmd_switch_on" });
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
	coolingStopSequence: () => [
		{ kind: "switch_off" },
		{ kind: "delay_ms", ms: AC_WRITE_REFRESH_DELAY_MS },
		{ kind: "toggle", role: "cmd_refresh" },
	],
	cleaningStartSequence: () => [{ kind: "set", role: "cmd_cleaning_start", value: "on" }],
	cleaningStopSequence: () => [
		{ kind: "set", role: "cmd_cleaning_start", value: "off" },
		{ kind: "toggle", role: "cmd_refresh" },
	],
};

export const SAMSUNG_SMARTTHINGS_PROFILE: AcProfile = {
	id: "samsung_smartthings",
	displayNameDe: "Samsung SmartThings",
	coolingStartSequence: samsungCoolingStart,
	// Nicht pulse-true auf dem Switch: das wäre „an“. Shared Switch → set off; eigener Off-Button → pulse.
	coolingStopSequence: () => [
		{ kind: "switch_off" },
		{ kind: "delay_ms", ms: AC_WRITE_REFRESH_DELAY_MS },
		{ kind: "toggle", role: "cmd_refresh" },
	],
	cleaningStartSequence: () => [
		{ kind: "toggle", role: "cmd_refresh" },
		{ kind: "set", role: "cmd_cleaning_start", value: "on" },
	],
	cleaningStopSequence: () => [
		{ kind: "set", role: "cmd_cleaning_start", value: "off" },
		{ kind: "toggle", role: "cmd_refresh" },
	],
};

/** Samsung WindFree / RAC über Home Assistant LocalThings → hass.0. */
export const SAMSUNG_LOCALTHINGS_HASS_PROFILE: AcProfile = {
	id: "samsung_localthings_hass",
	displayNameDe: "Samsung LocalThings (Home Assistant)",
	coolingStartSequence: localthingsCoolingStart,
	coolingStopSequence: () => [{ kind: "switch_off" }],
	cleaningStartSequence: () => [{ kind: "toggle", role: "cmd_cleaning_start" }],
	cleaningStopSequence: () => [{ kind: "toggle", role: "cmd_cleaning_off" }],
};

export const AC_PROFILES = [
	GENERIC_AC_PROFILE,
	SAMSUNG_SMARTTHINGS_PROFILE,
	SAMSUNG_LOCALTHINGS_HASS_PROFILE,
] as const;

export function getAcProfile(id: string): AcProfile {
	return AC_PROFILES.find((p) => p.id === id) ?? GENERIC_AC_PROFILE;
}

export function isLocalthingsHassProfile(id: string): boolean {
	return id === SAMSUNG_LOCALTHINGS_HASS_PROFILE.id;
}
