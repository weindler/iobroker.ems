/** EVCC read-only telemetry config (Phase 3B.1). Intent fields stay on intent_evcc_* keys. */

export const WB_EVCC_ENABLED = "wb_evcc_enabled_state";
export const WB_EVCC_CONNECTED = "wb_evcc_connected_state";
export const WB_EVCC_CHARGING = "wb_evcc_charging_state";
export const WB_EVCC_CHARGE_POWER_W = "wb_evcc_charge_power_w_state";
export const WB_EVCC_SESSION_ENERGY_KWH = "wb_evcc_session_energy_kwh_state";
export const WB_EVCC_VEHICLE_SOC = "wb_evcc_vehicle_soc_state";
export const WB_EVCC_PLAN_ACTIVE = "wb_evcc_plan_active_state";
export const WB_EVCC_PLAN_SOC = "wb_evcc_plan_soc_state";
export const WB_EVCC_PLAN_TIME = "wb_evcc_plan_time_state";
export const WB_EVCC_EFFECTIVE_PLAN_TIME = "wb_evcc_effective_plan_time_state";
export const WB_EVCC_ACTIVE_PHASES = "wb_evcc_active_phases_state";
export const WB_EVCC_CONFIGURED_PHASES = "wb_evcc_configured_phases_state";
export const WB_EVCC_MIN_CURRENT_A = "wb_evcc_min_current_a_state";
export const WB_EVCC_MAX_CURRENT_A = "wb_evcc_max_current_a_state";
export const WB_EVCC_BATTERY_MODE = "wb_evcc_battery_mode_state";
export const WB_EVCC_BATTERY_DISCHARGE_CONTROL = "wb_evcc_battery_discharge_control_state";

/** Synced to addons.wallbox.mapping.<role>.target_state */
export const WALLBOX_EVCC_TELEMETRY_ROLES = [
	"evcc_enabled",
	"evcc_connected",
	"evcc_charging",
	"evcc_charge_power_w",
	"evcc_session_energy_kwh",
	"evcc_vehicle_soc",
	"evcc_plan_active",
	"evcc_plan_soc",
	"evcc_plan_time",
	"evcc_effective_plan_time",
	"evcc_active_phases",
	"evcc_configured_phases",
	"evcc_min_current_a",
	"evcc_max_current_a",
	"evcc_battery_mode",
	"evcc_battery_discharge_control",
] as const;

export type WallboxEvccTelemetryRole = (typeof WALLBOX_EVCC_TELEMETRY_ROLES)[number];

/** @deprecated Legacy read mapping — compat only, not shown in admin. */
export const WB_LEGACY_VEHICLE_SOC = "wb_vehicle_soc_target";

export interface WallboxEvccTelemetryConfig {
	enabledStateId: string;
	connectedStateId: string;
	chargingStateId: string;
	chargePowerWStateId: string;
	sessionEnergyKwhStateId: string;
	vehicleSocStateId: string;
	planActiveStateId: string;
	planSocStateId: string;
	planTimeStateId: string;
	effectivePlanTimeStateId: string;
	activePhasesStateId: string;
	configuredPhasesStateId: string;
	minCurrentAStateId: string;
	maxCurrentAStateId: string;
	batteryModeStateId: string;
	batteryDischargeControlStateId: string;
}

function strField(c: Record<string, unknown>, key: string): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : "";
}

export function wallboxEvccTelemetryConfigFromAdapter(config: unknown): WallboxEvccTelemetryConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const vehicleSoc =
		strField(c, WB_EVCC_VEHICLE_SOC) || strField(c, WB_LEGACY_VEHICLE_SOC);
	return {
		enabledStateId: strField(c, WB_EVCC_ENABLED),
		connectedStateId: strField(c, WB_EVCC_CONNECTED),
		chargingStateId: strField(c, WB_EVCC_CHARGING),
		chargePowerWStateId: strField(c, WB_EVCC_CHARGE_POWER_W),
		sessionEnergyKwhStateId: strField(c, WB_EVCC_SESSION_ENERGY_KWH),
		vehicleSocStateId: vehicleSoc,
		planActiveStateId: strField(c, WB_EVCC_PLAN_ACTIVE),
		planSocStateId: strField(c, WB_EVCC_PLAN_SOC),
		planTimeStateId: strField(c, WB_EVCC_PLAN_TIME),
		effectivePlanTimeStateId: strField(c, WB_EVCC_EFFECTIVE_PLAN_TIME),
		activePhasesStateId: strField(c, WB_EVCC_ACTIVE_PHASES),
		configuredPhasesStateId: strField(c, WB_EVCC_CONFIGURED_PHASES),
		minCurrentAStateId: strField(c, WB_EVCC_MIN_CURRENT_A),
		maxCurrentAStateId: strField(c, WB_EVCC_MAX_CURRENT_A),
		batteryModeStateId: strField(c, WB_EVCC_BATTERY_MODE),
		batteryDischargeControlStateId: strField(c, WB_EVCC_BATTERY_DISCHARGE_CONTROL),
	};
}

export function configuredEvccTelemetryStateIds(cfg: WallboxEvccTelemetryConfig): string[] {
	const ids: string[] = [];
	for (const role of WALLBOX_EVCC_TELEMETRY_ROLES) {
		const id = stateIdForRole(cfg, role);
		if (id) ids.push(id);
	}
	return ids;
}

export function stateIdForRole(cfg: WallboxEvccTelemetryConfig, role: WallboxEvccTelemetryRole): string {
	switch (role) {
		case "evcc_enabled":
			return cfg.enabledStateId;
		case "evcc_connected":
			return cfg.connectedStateId;
		case "evcc_charging":
			return cfg.chargingStateId;
		case "evcc_charge_power_w":
			return cfg.chargePowerWStateId;
		case "evcc_session_energy_kwh":
			return cfg.sessionEnergyKwhStateId;
		case "evcc_vehicle_soc":
			return cfg.vehicleSocStateId;
		case "evcc_plan_active":
			return cfg.planActiveStateId;
		case "evcc_plan_soc":
			return cfg.planSocStateId;
		case "evcc_plan_time":
			return cfg.planTimeStateId;
		case "evcc_effective_plan_time":
			return cfg.effectivePlanTimeStateId;
		case "evcc_active_phases":
			return cfg.activePhasesStateId;
		case "evcc_configured_phases":
			return cfg.configuredPhasesStateId;
		case "evcc_min_current_a":
			return cfg.minCurrentAStateId;
		case "evcc_max_current_a":
			return cfg.maxCurrentAStateId;
		case "evcc_battery_mode":
			return cfg.batteryModeStateId;
		case "evcc_battery_discharge_control":
			return cfg.batteryDischargeControlStateId;
		default:
			return "";
	}
}

export type NativeMappingEntry = {
	enabled?: boolean;
	target_state?: string;
	allowed_values?: string;
};

/** Builds addons.wallbox.mapping.* entries from flat wb_evcc_* config keys. */
export function wallboxEvccTelemetryMappingFromConfig(
	config: Record<string, unknown>,
): Record<string, NativeMappingEntry> {
	const cfg = wallboxEvccTelemetryConfigFromAdapter(config);
	const out: Record<string, NativeMappingEntry> = {};
	for (const role of WALLBOX_EVCC_TELEMETRY_ROLES) {
		const stateId = stateIdForRole(cfg, role);
		if (stateId) {
			out[role] = { enabled: true, target_state: stateId };
		}
	}
	return out;
}

/** True when any legacy go-e write mapping is configured (for failsafe/pipeline guard). */
export function hasLegacyWallboxWriteMapping(config: unknown): boolean {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const legacyKeys = [
		"wb_set_enabled_target",
		"wb_set_current_a_target",
		"wb_set_charge_power_w_target",
		"wb_set_phase_switch_target",
	];
	return legacyKeys.some((k) => typeof c[k] === "string" && String(c[k]).trim().length > 0);
}
