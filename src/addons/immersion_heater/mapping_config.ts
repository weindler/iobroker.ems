export const IMMERSION_HEATER_MAPPING_COMMANDS = ["set_enabled"] as const;

export type ImmersionMappingCommand = (typeof IMMERSION_HEATER_MAPPING_COMMANDS)[number];

export const IMMERSION_FLAT_PREFIX: Record<ImmersionMappingCommand, string> = {
	set_enabled: "ih_set_enabled",
};

export interface NativeMappingEntry {
	enabled?: boolean;
	target_state?: string;
	allowed_values?: string;
}

export function immersionHeaterMappingFromConfig(
	config: Record<string, unknown>,
): Record<string, NativeMappingEntry> {
	const out: Record<string, NativeMappingEntry> = {};

	for (const cmd of IMMERSION_HEATER_MAPPING_COMMANDS) {
		const prefix = IMMERSION_FLAT_PREFIX[cmd];
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

		if (entry.target_state !== undefined || entry.enabled !== undefined || entry.allowed_values !== undefined) {
			out[cmd] = entry;
		}
	}

	return out;
}
