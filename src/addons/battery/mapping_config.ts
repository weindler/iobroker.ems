/** Sonnen-Profil: logische Rollen → ioBroker-States (jsonConfig / objectId-Picker). */

export const BATTERY_SONNEN_MAPPING_ROLES = [
	"consumption_w",
	"pv_ac_power_w",
	"battery_charging_w",
	"soc_pct",
	"capacity_wh",
] as const;

export type BatterySonnenMappingRole = (typeof BATTERY_SONNEN_MAPPING_ROLES)[number];

export const BATTERY_SONNEN_FLAT_PREFIX: Record<BatterySonnenMappingRole, string> = {
	consumption_w: "bat_consumption",
	pv_ac_power_w: "bat_pv_ac",
	battery_charging_w: "bat_battery_charging",
	soc_pct: "bat_soc",
	capacity_wh: "bat_capacity",
};

export interface NativeMappingEntry {
	enabled?: boolean;
	target_state?: string;
	allowed_values?: string;
}

export interface BatteryNativeConfig extends Record<string, unknown> {
	/** Profil für spätere Systeme (z. B. andere Batterie-APIs). */
	battery_profile?: string;
	bat_tick_interval_sec?: number;
	bat_capacity_wh_const?: number;
	bat_active_months?: string;
	mapping?: Record<string, Record<string, NativeMappingEntry>>;
}

export function sonnenBatteryMappingFromConfig(
	config: Record<string, unknown>,
): Record<string, NativeMappingEntry> {
	const nested = (config as BatteryNativeConfig).mapping?.battery;
	const out: Record<string, NativeMappingEntry> = {};

	for (const role of BATTERY_SONNEN_MAPPING_ROLES) {
		const prefix = BATTERY_SONNEN_FLAT_PREFIX[role];
		const entry: NativeMappingEntry = {};

		const t = config[`${prefix}_target`];
		if (typeof t === "string" && t.trim()) {
			entry.target_state = t.trim();
		}
		const en = config[`${prefix}_enabled`];
		if (typeof en === "boolean") {
			entry.enabled = en;
		}

		const nest = nested?.[role];
		if (nest && typeof nest === "object") {
			if (typeof nest.target_state === "string" && nest.target_state.trim()) {
				entry.target_state = nest.target_state.trim();
			}
			if (typeof nest.enabled === "boolean") {
				entry.enabled = nest.enabled;
			}
		}

		if (entry.target_state || typeof entry.enabled === "boolean") {
			out[role] = entry;
		}
	}
	return out;
}

export function batteryProfileFromConfig(config: Record<string, unknown>): string {
	const p = (config as BatteryNativeConfig).battery_profile;
	if (typeof p === "string" && p.trim()) {
		return p.trim().toLowerCase();
	}
	return "sonnen";
}

export function tickIntervalSecFromConfig(config: Record<string, unknown>): number {
	const v = (config as BatteryNativeConfig).bat_tick_interval_sec;
	if (typeof v === "number" && Number.isFinite(v) && v >= 15) {
		return Math.min(300, Math.floor(v));
	}
	return 45;
}

export function capacityWhFromConfig(config: Record<string, unknown>): number | null {
	const v = (config as BatteryNativeConfig).bat_capacity_wh_const;
	if (typeof v === "number" && Number.isFinite(v) && v > 0) {
		return v;
	}
	return null;
}

/** Kalendermonate 1–12 für Sommer-Gate (Blockly-Äquivalent). */
export function activeMonthsFromConfig(config: Record<string, unknown>): number[] {
	const raw = (config as BatteryNativeConfig).bat_active_months;
	const def = [3, 4, 5, 6, 7, 8, 9, 10];
	if (typeof raw !== "string" || !raw.trim()) {
		return def;
	}
	const s = raw.trim();
	try {
		const parsed = JSON.parse(s) as unknown;
		if (Array.isArray(parsed)) {
			return parsed
				.map((x) => Number(x))
				.filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
		}
	} catch {
		/* CSV fallback */
	}
	return s
		.split(/[,;\s]+/)
		.map((x) => Number(x.trim()))
		.filter((m) => Number.isFinite(m) && m >= 1 && m <= 12);
}
