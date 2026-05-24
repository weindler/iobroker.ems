/** Wallbox-Befehle mit Mapping (logischer command = mapping_id). */

export const WALLBOX_MAPPING_COMMANDS = [
	"set_enabled",
	"set_current_a",
	"set_charge_power_w",
	"set_phase_switch_enabled",
] as const;

export type WallboxMappingCommand = (typeof WALLBOX_MAPPING_COMMANDS)[number];

export interface NativeMappingEntry {
	enabled?: boolean;
	target_state?: string;
	allowed_values?: string;
}

export interface EmsNativeConfig {
	mapping?: Record<string, Record<string, NativeMappingEntry>>;
}

/** Optionale go-e-Vorlage — nur per Admin-Button, nie automatisch beim Start. */
export const GOE_WALLBOX_TEMPLATE: Record<string, NativeMappingEntry> = {
	set_enabled: {
		enabled: true,
		target_state: "go-e.0.allow_charging",
		allowed_values: "[true,false,0,1]",
	},
	set_current_a: { enabled: true, target_state: "go-e.0.ampere" },
	set_charge_power_w: { enabled: true, target_state: "go-e.0.ampere" },
	set_phase_switch_enabled: {
		enabled: true,
		target_state: "go-e.0.phaseSwitchModeEnabled",
		allowed_values: "[true,false]",
	},
};
