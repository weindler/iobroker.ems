/** Batterie-Mapping: logische Rollen → ioBroker-States (jsonConfig / objectId-Picker). */

export const BATTERY_READ_ROLES = [
	"soc_pct",
	"power_w",
	"charging_power_w",
	"discharging_power_w",
	"capacity_kwh",
	"seconds_since_full_charge",
	"operating_mode_read",
	"online",
	"consumption_w",
	"pv_ac_power_w",
] as const;

export const BATTERY_WRITE_ROLES = ["set_operating_mode", "set_charge_power"] as const;

export const BATTERY_MAPPING_ROLES = [...BATTERY_READ_ROLES, ...BATTERY_WRITE_ROLES] as const;

export type BatteryMappingRole = (typeof BATTERY_MAPPING_ROLES)[number];

/** Admin-Flat-Präfixe; bewusst rückwärtskompatibel zu v0.1.64-Schlüsseln. */
export const BATTERY_MAPPING_FLAT_PREFIX: Record<BatteryMappingRole, string> = {
	soc_pct: "bat_soc",
	power_w: "bat_power",
	charging_power_w: "bat_charging_power",
	discharging_power_w: "bat_discharging_power",
	capacity_kwh: "bat_capacity_kwh",
	seconds_since_full_charge: "bat_seconds_since_full",
	operating_mode_read: "bat_operating_mode_read",
	online: "bat_online",
	consumption_w: "bat_consumption",
	pv_ac_power_w: "bat_pv_ac",
	set_operating_mode: "bat_operating_mode",
	set_charge_power: "bat_battery_charging",
};

export interface NativeMappingEntry {
	enabled?: boolean;
	target_state?: string;
}

export interface BatteryMappingSlot {
	enabled: boolean;
	targetState: string;
}

export type BatteryMappingTable = Record<BatteryMappingRole, BatteryMappingSlot>;

function rec(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

export function batteryMappingFromConfig(config: unknown): BatteryMappingTable {
	const c = rec(config);
	const nested = (c.mapping as Record<string, Record<string, NativeMappingEntry>> | undefined)?.battery;
	const table = {} as BatteryMappingTable;

	for (const role of BATTERY_MAPPING_ROLES) {
		const prefix = BATTERY_MAPPING_FLAT_PREFIX[role];
		let enabled = c[`${prefix}_enabled`];
		let target = c[`${prefix}_target`];

		const nest = nested?.[role];
		if (nest && typeof nest === "object") {
			if (typeof nest.enabled === "boolean") enabled = nest.enabled;
			if (typeof nest.target_state === "string" && nest.target_state.trim()) target = nest.target_state;
		}

		const targetState = typeof target === "string" ? target.trim() : "";
		// operating_mode_read defaults to the operating-mode write target if unset.
		table[role] = {
			enabled: typeof enabled === "boolean" ? enabled : true,
			targetState,
		};
	}

	if (!table.operating_mode_read.targetState && table.set_operating_mode.targetState) {
		table.operating_mode_read = {
			enabled: table.set_operating_mode.enabled,
			targetState: table.set_operating_mode.targetState,
		};
	}

	return table;
}

/** Für mapping_sync: logische Rollen → native Mapping-Einträge. */
export function batteryMappingNativeFromConfig(
	config: Record<string, unknown>,
): Record<string, NativeMappingEntry> {
	const table = batteryMappingFromConfig(config);
	const out: Record<string, NativeMappingEntry> = {};
	for (const role of BATTERY_MAPPING_ROLES) {
		const slot = table[role];
		if (slot.targetState || typeof slot.enabled === "boolean") {
			out[role] = { enabled: slot.enabled, target_state: slot.targetState };
		}
	}
	return out;
}

/** Eine Rolle gilt als konfiguriert, wenn enabled und ein Ziel-State gesetzt ist. */
export function isMappingConfigured(table: BatteryMappingTable, role: BatteryMappingRole): boolean {
	const slot = table[role];
	return !!slot && slot.enabled && slot.targetState.length > 0;
}

export function missingMappings(
	table: BatteryMappingTable,
	roles: readonly BatteryMappingRole[],
): BatteryMappingRole[] {
	return roles.filter((r) => !isMappingConfigured(table, r));
}
