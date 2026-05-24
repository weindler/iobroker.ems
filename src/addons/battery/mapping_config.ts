/** Sonnen-Profil: logische Rollen → ioBroker-States (jsonConfig / objectId-Picker). */

export const BATTERY_SONNEN_MAPPING_ROLES = [
	"consumption_w",
	"pv_ac_power_w",
	"battery_charging_w",
	"soc_pct",
	"operating_mode",
] as const;

export type BatterySonnenMappingRole = (typeof BATTERY_SONNEN_MAPPING_ROLES)[number];

export const BATTERY_SONNEN_FLAT_PREFIX: Record<BatterySonnenMappingRole, string> = {
	consumption_w: "bat_consumption",
	pv_ac_power_w: "bat_pv_ac",
	battery_charging_w: "bat_battery_charging",
	soc_pct: "bat_soc",
	operating_mode: "bat_operating_mode",
};

export interface NativeMappingEntry {
	enabled?: boolean;
	target_state?: string;
	allowed_values?: string;
}

export interface BatteryNativeConfig extends Record<string, unknown> {
	battery_profile?: string;
	bat_feature_grid_balance_enabled?: boolean;
	bat_offset_high_soc_w?: number;
	bat_offset_low_soc_w?: number;
	bat_offset_soc_threshold_pct?: number;
	bat_winter_tick_interval_sec?: number;
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

export function featureGridBalanceFromConfig(config: Record<string, unknown>): boolean {
	return (config as BatteryNativeConfig).bat_feature_grid_balance_enabled === true;
}

export interface GridBalanceOffsetConfig {
	offsetHighSocW: number;
	offsetLowSocW: number;
	socThresholdPct: number;
}

export function gridBalanceOffsetsFromConfig(config: Record<string, unknown>): GridBalanceOffsetConfig {
	const c = config as BatteryNativeConfig;
	const high = c.bat_offset_high_soc_w;
	const low = c.bat_offset_low_soc_w;
	const thr = c.bat_offset_soc_threshold_pct;
	return {
		offsetHighSocW: typeof high === "number" && high >= 0 ? Math.round(high) : 25,
		offsetLowSocW: typeof low === "number" && low >= 0 ? Math.round(low) : 10,
		socThresholdPct: typeof thr === "number" && thr > 0 ? thr : 20,
	};
}

export function winterTickIntervalSecFromConfig(config: Record<string, unknown>): number {
	const v = (config as BatteryNativeConfig).bat_winter_tick_interval_sec;
	if (typeof v === "number" && Number.isFinite(v) && v >= 15) {
		return Math.min(300, Math.floor(v));
	}
	return 45;
}
