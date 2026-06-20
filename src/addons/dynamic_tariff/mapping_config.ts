/** Dynamischer Tarif: read-only Mess-Mapping (z. B. Tibber). */

export const DYNAMIC_TARIFF_MAPPING_ROLES = ["price_now_ct_per_kwh"] as const;

export type DynamicTariffMappingRole = (typeof DYNAMIC_TARIFF_MAPPING_ROLES)[number];

export const DYNAMIC_TARIFF_FLAT_PREFIX: Record<DynamicTariffMappingRole, string> = {
	price_now_ct_per_kwh: "dt_price_now",
};

export interface NativeMappingEntry {
	enabled?: boolean;
	target_state?: string;
	allowed_values?: string;
}

export function dynamicTariffMappingFromConfig(
	config: Record<string, unknown>,
): Record<string, NativeMappingEntry> {
	const out: Record<string, NativeMappingEntry> = {};

	for (const role of DYNAMIC_TARIFF_MAPPING_ROLES) {
		const prefix = DYNAMIC_TARIFF_FLAT_PREFIX[role];
		const entry: NativeMappingEntry = {};

		const t = config[`${prefix}_target`];
		if (typeof t === "string" && t.trim()) {
			entry.target_state = t.trim();
		}
		const en = config[`${prefix}_enabled`];
		if (typeof en === "boolean") {
			entry.enabled = en;
		}

		if (entry.target_state !== undefined || entry.enabled !== undefined) {
			out[role] = entry;
		}
	}

	return out;
}
