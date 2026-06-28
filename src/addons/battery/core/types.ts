/** Gemeinsamer Batterie-Datenvertrag (herstellerneutral). */

export type BatteryProfileId = "generic_readonly" | "sonnen_em";

export type CapacitySource = "manual" | "mapped" | "unknown";

export type PowerSignConvention = "positive_charge" | "positive_discharge";

export type BatteryOperatingMode =
	| "unknown"
	| "self_consumption"
	| "manual"
	| "charging"
	| "grid_charging"
	| "discharging"
	| "hold"
	| "idle"
	| "fault";

export interface BatteryIdentity {
	manufacturer: string;
	model: string;
	controllerProfile: BatteryProfileId;
	capacityNetKwh: number | null;
	capacitySource: CapacitySource;
}

export interface BatteryTelemetry {
	socPct: number | null;
	powerW: number | null;
	chargingPowerW: number | null;
	dischargingPowerW: number | null;
	capacityNetKwh: number | null;
	operatingMode: BatteryOperatingMode;
	online: boolean | null;
	updatedAt: string | null;
	valid: boolean;
	stale: boolean;
}

export interface BatteryTelemetryQuality {
	socValid: boolean;
	powerValid: boolean;
	capacityValid: boolean;
	modeValid: boolean;
	stale: boolean;
	lastValidTelemetryAt: string | null;
	missingRequiredValues: string[];
}

export interface BatteryHardwareLimits {
	maxChargeW: number | null;
	maxDischargeW: number | null;
	minSocPct: number | null;
	maxSocPct: number | null;
	valid: boolean;
	issues: string[];
}

export interface BatteryCapacityResult {
	manualKwh: number | null;
	mappedKwh: number | null;
	effectiveKwh: number | null;
	source: CapacitySource;
	valid: boolean;
}

export interface BatteryEnergyDerived {
	energyStoredKwh: number | null;
	energyFreeToFullKwh: number | null;
	energyAboveTechnicalMinKwh: number | null;
}

export type BatteryCapabilityId =
	| "read_soc"
	| "read_power"
	| "read_capacity"
	| "read_operating_mode"
	| "read_online_status"
	| "set_operating_mode"
	| "set_charge_power"
	| "set_discharge_power"
	| "enable_grid_charge"
	| "hold_battery"
	| "control_grid_balance"
	| "verify_operating_mode"
	| "verify_charge_power"
	| "safe_restore"
	| "live_control";

export interface CapabilityStatus {
	supported: boolean;
	configured: boolean;
	available: boolean;
	reason?: string;
}

export type CapabilityMatrix = Record<BatteryCapabilityId, CapabilityStatus>;

export type BatteryAction =
	| "self_consumption"
	| "charge"
	| "grid_charge"
	| "hold"
	| "protect_reserve"
	| "topoff"
	| "safe_default";

export type BatteryEnergySource = "pv" | "grid" | "any" | "unknown";

export interface BatteryDeviceIntent {
	requestId: string;
	action: BatteryAction;
	targetSocPct: number | null;
	maxChargeW: number | null;
	maxDischargeW: number | null;
	energySource: BatteryEnergySource;
	validFrom: string | null;
	validUntil: string | null;
	issuedAt: string | null;
	reason: string;
	source: string;
}
