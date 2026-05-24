/** Wallbox-Befehle mit Mapping (logischer command = mapping_id). */

export const WALLBOX_MAPPING_COMMANDS = [
	"set_enabled",
	"set_current_a",
	"set_charge_power_w",
	"set_phase_switch_enabled",
] as const;

export type WallboxMappingCommand = (typeof WALLBOX_MAPPING_COMMANDS)[number];

/** Native-Keys in Instanz-Konfiguration (jsonConfig / objectId-Picker). */
export const WALLBOX_FLAT_PREFIX: Record<WallboxMappingCommand, string> = {
	set_enabled: "wb_set_enabled",
	set_current_a: "wb_set_current_a",
	set_charge_power_w: "wb_set_charge_power_w",
	set_phase_switch_enabled: "wb_set_phase_switch",
};

export interface NativeMappingEntry {
	enabled?: boolean;
	target_state?: string;
	allowed_values?: string;
}

export interface EmsNativeConfig extends Record<string, unknown> {
	mapping?: Record<string, Record<string, NativeMappingEntry>>;
}

/** go-e-Vorlage für Admin-Button applyGoeTemplate (flache Native-Keys). */
export function goeWallboxTemplateFlat(): Record<string, string | boolean> {
	return {
		wb_set_enabled_target: "go-e.0.allow_charging",
		wb_set_enabled_enabled: true,
		wb_set_enabled_allowed: "[true,false,0,1]",
		wb_set_current_a_target: "go-e.0.ampere",
		wb_set_current_a_enabled: true,
		wb_set_charge_power_w_target: "go-e.0.ampere",
		wb_set_charge_power_w_enabled: true,
		wb_set_phase_switch_target: "go-e.0.phaseSwitchModeEnabled",
		wb_set_phase_switch_enabled: true,
		wb_set_phase_switch_allowed: "[true,false]",
	};
}

export function wallboxMappingFromConfig(config: Record<string, unknown>): Record<string, NativeMappingEntry> {
	const nested = (config as EmsNativeConfig).mapping?.wallbox;
	const out: Record<string, NativeMappingEntry> = {};

	for (const cmd of WALLBOX_MAPPING_COMMANDS) {
		const prefix = WALLBOX_FLAT_PREFIX[cmd];
		const entry: NativeMappingEntry = {};

		const t = config[`${prefix}_target`];
		if (typeof t === "string" && t.trim()) {
			entry.target_state = t.trim();
		}
		const en = config[`${prefix}_enabled`];
		if (typeof en === "boolean") {
			entry.enabled = en;
		}
		const av = config[`${prefix}_allowed`];
		if (typeof av === "string" && av.trim()) {
			entry.allowed_values = av.trim();
		}

		const nest = nested?.[cmd];
		if (nest && typeof nest === "object") {
			if (typeof nest.target_state === "string" && nest.target_state.trim()) {
				entry.target_state = nest.target_state.trim();
			}
			if (typeof nest.enabled === "boolean") {
				entry.enabled = nest.enabled;
			}
			if (typeof nest.allowed_values === "string" && nest.allowed_values.trim()) {
				entry.allowed_values = nest.allowed_values.trim();
			}
		}

		if (entry.target_state || entry.allowed_values || typeof entry.enabled === "boolean") {
			out[cmd] = entry;
		}
	}
	return out;
}
