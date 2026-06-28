import type { BatteryCapabilityId, CapabilityMatrix, CapabilityStatus } from "./types";

export const ALL_BATTERY_CAPABILITIES: BatteryCapabilityId[] = [
	"read_soc",
	"read_power",
	"read_capacity",
	"read_operating_mode",
	"read_online_status",
	"set_operating_mode",
	"set_charge_power",
	"set_discharge_power",
	"enable_grid_charge",
	"hold_battery",
	"control_grid_balance",
	"verify_operating_mode",
	"verify_charge_power",
	"safe_restore",
	"live_control",
];

export function capability(
	supported: boolean,
	configured: boolean,
	reason?: string,
): CapabilityStatus {
	const available = supported && configured;
	const status: CapabilityStatus = { supported, configured, available };
	if (!available && reason) {
		status.reason = reason;
	}
	return status;
}

export function emptyCapabilityMatrix(): CapabilityMatrix {
	const matrix = {} as CapabilityMatrix;
	for (const id of ALL_BATTERY_CAPABILITIES) {
		matrix[id] = { supported: false, configured: false, available: false };
	}
	return matrix;
}

export function isCapabilityAvailable(matrix: CapabilityMatrix, id: BatteryCapabilityId): boolean {
	return matrix[id]?.available === true;
}
