import type { AcMappingRole } from "../constants";
import type { AcUnitConfig, AcUnitModePurpose } from "../types";

export type AcWriteStep =
	| { kind: "set"; role: AcMappingRole; value: string | number | boolean }
	/** hass.0 Climate-Aktionen: stringified JSON, nie boolean/true. */
	| { kind: "set_json"; role: AcMappingRole; payload: Record<string, unknown> }
	| { kind: "toggle"; role: AcMappingRole }
	| { kind: "switch_off" }
	| { kind: "delay_ms"; ms: number };

export type AcProfile = {
	id: string;
	displayNameDe: string;
	coolingStartSequence: (unit: AcUnitConfig, purpose: AcUnitModePurpose) => AcWriteStep[];
	/** Optional; default engine uses smart switch_off when missing. */
	coolingStopSequence?: () => AcWriteStep[];
	cleaningStartSequence: () => AcWriteStep[];
	cleaningStopSequence: () => AcWriteStep[];
};

export function modeStringsForPurpose(unit: AcUnitConfig, purpose: AcUnitModePurpose): { mode: string; fanMode: string; fanSpeed: string } {
	switch (purpose) {
		case "dehumidify":
			return {
				mode: unit.modeWhenDehumidify,
				fanMode: unit.fanModeWhenDehumidify,
				fanSpeed: "",
			};
		case "fan_only":
			return {
				mode: unit.modeWhenFanOnly,
				fanMode: unit.fanModeWhenFanOnly,
				fanSpeed: "",
			};
		case "heating":
			return {
				mode: unit.modeWhenHeating,
				fanMode: unit.fanModeWhenHeating,
				fanSpeed: "",
			};
		default:
			return {
				mode: unit.modeWhenCooling,
				fanMode: unit.fanModeWhenCooling,
				fanSpeed: unit.fanSpeedWhenCooling,
			};
	}
}

export function optionalStep(role: AcMappingRole, value: string | number | boolean): AcWriteStep[] {
	if (value === "" || value === null || value === undefined) {
		return [];
	}
	return [{ kind: "set", role, value }];
}
