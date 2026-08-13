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
export const WB_EVCC_CHARGE_REMAINING_ENERGY = "wb_evcc_charge_remaining_energy_state";
export const WB_EVCC_VEHICLE_NAME = "wb_evcc_vehicle_name_state";
export const WB_EVCC_VEHICLE_TITLE = "wb_evcc_vehicle_title_state";
export const WB_EVCC_EFFECTIVE_LIMIT_SOC = "wb_evcc_effective_limit_soc_state";
export const WB_EVCC_BATTERY_BOOST = "wb_evcc_battery_boost_state";
export const WB_EVCC_LOADPOINT_MODE = "wb_evcc_loadpoint_mode_state";
export const WB_EVCC_CONNECTION = "wb_evcc_connection_state";
export const WB_EVCC_VEHICLE_RANGE = "wb_evcc_vehicle_range_state";
export const WB_EVCC_VEHICLE_ODOMETER = "wb_evcc_vehicle_odometer_state";
export const WB_EVCC_CHARGE_REMAINING_DURATION = "wb_evcc_charge_remaining_duration_state";
export const WB_EVCC_EFFECTIVE_MAX_CURRENT = "wb_evcc_effective_max_current_state";
export const WB_EVCC_EFFECTIVE_MIN_CURRENT = "wb_evcc_effective_min_current_state";
export const WB_EVCC_OFFERED_CURRENT = "wb_evcc_offered_current_state";
export const WB_EVCC_CHARGE_CURRENTS = "wb_evcc_charge_currents_state";
export const WB_EVCC_CHARGE_VOLTAGES = "wb_evcc_charge_voltages_state";
export const WB_EVCC_SESSION_PRICE = "wb_evcc_session_price_state";
export const WB_EVCC_SESSION_PRICE_PER_KWH = "wb_evcc_session_price_per_kwh_state";
export const WB_EVCC_VEHICLE_DETECTION_ACTIVE = "wb_evcc_vehicle_detection_active_state";
export const WB_EVCC_SMART_COST_LIMIT = "wb_evcc_smart_cost_limit_state";
export const WB_EVCC_SMART_COST_ACTIVE = "wb_evcc_smart_cost_active_state";

/** Optional foreign signals (not EVCC telemetry roles). */
export const WB_EXTERNAL_VEHICLE_CHARGE = "wb_external_vehicle_charge_state";
export const WB_TIBBER_GRID_REWARDS_ACTIVE = "wb_tibber_grid_rewards_active_state";

/** Synced to addons.wallbox.mapping.<role>.target_state */
export const WALLBOX_EVCC_TELEMETRY_ROLES = [
	"evcc_enabled",
	"evcc_connected",
	"evcc_charging",
	"evcc_charge_power_w",
	"evcc_session_energy_kwh",
	"evcc_charge_remaining_energy_kwh",
	"evcc_vehicle_soc",
	"evcc_vehicle_name",
	"evcc_vehicle_title",
	"evcc_plan_active",
	"evcc_plan_soc",
	"evcc_plan_time",
	"evcc_effective_plan_time",
	"evcc_effective_limit_soc",
	"evcc_battery_boost",
	"evcc_loadpoint_mode",
	"evcc_active_phases",
	"evcc_configured_phases",
	"evcc_min_current_a",
	"evcc_max_current_a",
	"evcc_battery_mode",
	"evcc_battery_discharge_control",
	"evcc_connection",
	"evcc_vehicle_range_km",
	"evcc_vehicle_odometer_km",
	"evcc_charge_remaining_duration_s",
	"evcc_effective_max_current_a",
	"evcc_effective_min_current_a",
	"evcc_offered_current_a",
	"evcc_charge_currents",
	"evcc_charge_voltages",
	"evcc_session_price",
	"evcc_session_price_per_kwh",
	"evcc_vehicle_detection_active",
	"evcc_smart_cost_limit",
	"evcc_smart_cost_active",
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
	chargeRemainingEnergyKwhStateId: string;
	vehicleSocStateId: string;
	vehicleNameStateId: string;
	vehicleTitleStateId: string;
	planActiveStateId: string;
	planSocStateId: string;
	planTimeStateId: string;
	effectivePlanTimeStateId: string;
	effectiveLimitSocStateId: string;
	batteryBoostStateId: string;
	loadpointModeStateId: string;
	activePhasesStateId: string;
	configuredPhasesStateId: string;
	minCurrentAStateId: string;
	maxCurrentAStateId: string;
	batteryModeStateId: string;
	batteryDischargeControlStateId: string;
	connectionStateId: string;
	vehicleRangeKmStateId: string;
	vehicleOdometerKmStateId: string;
	chargeRemainingDurationSStateId: string;
	effectiveMaxCurrentAStateId: string;
	effectiveMinCurrentAStateId: string;
	offeredCurrentAStateId: string;
	chargeCurrentsStateId: string;
	chargeVoltagesStateId: string;
	sessionPriceStateId: string;
	sessionPricePerKwhStateId: string;
	vehicleDetectionActiveStateId: string;
	smartCostLimitStateId: string;
	smartCostActiveStateId: string;
}

export const EVCC_TELEMETRY_ROLE_CONFIG_FIELD: Record<
	WallboxEvccTelemetryRole,
	keyof WallboxEvccTelemetryConfig
> = {
	evcc_enabled: "enabledStateId",
	evcc_connected: "connectedStateId",
	evcc_charging: "chargingStateId",
	evcc_charge_power_w: "chargePowerWStateId",
	evcc_session_energy_kwh: "sessionEnergyKwhStateId",
	evcc_charge_remaining_energy_kwh: "chargeRemainingEnergyKwhStateId",
	evcc_vehicle_soc: "vehicleSocStateId",
	evcc_vehicle_name: "vehicleNameStateId",
	evcc_vehicle_title: "vehicleTitleStateId",
	evcc_plan_active: "planActiveStateId",
	evcc_plan_soc: "planSocStateId",
	evcc_plan_time: "planTimeStateId",
	evcc_effective_plan_time: "effectivePlanTimeStateId",
	evcc_effective_limit_soc: "effectiveLimitSocStateId",
	evcc_battery_boost: "batteryBoostStateId",
	evcc_loadpoint_mode: "loadpointModeStateId",
	evcc_active_phases: "activePhasesStateId",
	evcc_configured_phases: "configuredPhasesStateId",
	evcc_min_current_a: "minCurrentAStateId",
	evcc_max_current_a: "maxCurrentAStateId",
	evcc_battery_mode: "batteryModeStateId",
	evcc_battery_discharge_control: "batteryDischargeControlStateId",
	evcc_connection: "connectionStateId",
	evcc_vehicle_range_km: "vehicleRangeKmStateId",
	evcc_vehicle_odometer_km: "vehicleOdometerKmStateId",
	evcc_charge_remaining_duration_s: "chargeRemainingDurationSStateId",
	evcc_effective_max_current_a: "effectiveMaxCurrentAStateId",
	evcc_effective_min_current_a: "effectiveMinCurrentAStateId",
	evcc_offered_current_a: "offeredCurrentAStateId",
	evcc_charge_currents: "chargeCurrentsStateId",
	evcc_charge_voltages: "chargeVoltagesStateId",
	evcc_session_price: "sessionPriceStateId",
	evcc_session_price_per_kwh: "sessionPricePerKwhStateId",
	evcc_vehicle_detection_active: "vehicleDetectionActiveStateId",
	evcc_smart_cost_limit: "smartCostLimitStateId",
	evcc_smart_cost_active: "smartCostActiveStateId",
};

export function emptyWallboxEvccTelemetryConfig(): WallboxEvccTelemetryConfig {
	return {
		enabledStateId: "",
		connectedStateId: "",
		chargingStateId: "",
		chargePowerWStateId: "",
		sessionEnergyKwhStateId: "",
		chargeRemainingEnergyKwhStateId: "",
		vehicleSocStateId: "",
		vehicleNameStateId: "",
		vehicleTitleStateId: "",
		planActiveStateId: "",
		planSocStateId: "",
		planTimeStateId: "",
		effectivePlanTimeStateId: "",
		effectiveLimitSocStateId: "",
		batteryBoostStateId: "",
		loadpointModeStateId: "",
		activePhasesStateId: "",
		configuredPhasesStateId: "",
		minCurrentAStateId: "",
		maxCurrentAStateId: "",
		batteryModeStateId: "",
		batteryDischargeControlStateId: "",
		connectionStateId: "",
		vehicleRangeKmStateId: "",
		vehicleOdometerKmStateId: "",
		chargeRemainingDurationSStateId: "",
		effectiveMaxCurrentAStateId: "",
		effectiveMinCurrentAStateId: "",
		offeredCurrentAStateId: "",
		chargeCurrentsStateId: "",
		chargeVoltagesStateId: "",
		sessionPriceStateId: "",
		sessionPricePerKwhStateId: "",
		vehicleDetectionActiveStateId: "",
		smartCostLimitStateId: "",
		smartCostActiveStateId: "",
	};
}

/** Optional non-EVCC foreign mappings for hold decision. */
export interface WallboxHoldSignalConfig {
	externalVehicleChargeStateId: string;
	tibberGridRewardsActiveStateId: string;
}

function strField(c: Record<string, unknown>, key: string): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : "";
}

export function wallboxEvccTelemetryConfigFromAdapter(config: unknown): WallboxEvccTelemetryConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const vehicleSoc = strField(c, WB_EVCC_VEHICLE_SOC) || strField(c, WB_LEGACY_VEHICLE_SOC);
	return {
		...emptyWallboxEvccTelemetryConfig(),
		enabledStateId: strField(c, WB_EVCC_ENABLED),
		connectedStateId: strField(c, WB_EVCC_CONNECTED),
		chargingStateId: strField(c, WB_EVCC_CHARGING),
		chargePowerWStateId: strField(c, WB_EVCC_CHARGE_POWER_W),
		sessionEnergyKwhStateId: strField(c, WB_EVCC_SESSION_ENERGY_KWH),
		chargeRemainingEnergyKwhStateId: strField(c, WB_EVCC_CHARGE_REMAINING_ENERGY),
		vehicleSocStateId: vehicleSoc,
		vehicleNameStateId: strField(c, WB_EVCC_VEHICLE_NAME),
		vehicleTitleStateId: strField(c, WB_EVCC_VEHICLE_TITLE),
		planActiveStateId: strField(c, WB_EVCC_PLAN_ACTIVE),
		planSocStateId: strField(c, WB_EVCC_PLAN_SOC),
		planTimeStateId: strField(c, WB_EVCC_PLAN_TIME),
		effectivePlanTimeStateId: strField(c, WB_EVCC_EFFECTIVE_PLAN_TIME),
		effectiveLimitSocStateId: strField(c, WB_EVCC_EFFECTIVE_LIMIT_SOC),
		batteryBoostStateId: strField(c, WB_EVCC_BATTERY_BOOST),
		loadpointModeStateId: strField(c, WB_EVCC_LOADPOINT_MODE),
		activePhasesStateId: strField(c, WB_EVCC_ACTIVE_PHASES),
		configuredPhasesStateId: strField(c, WB_EVCC_CONFIGURED_PHASES),
		minCurrentAStateId: strField(c, WB_EVCC_MIN_CURRENT_A),
		maxCurrentAStateId: strField(c, WB_EVCC_MAX_CURRENT_A),
		batteryModeStateId: strField(c, WB_EVCC_BATTERY_MODE),
		batteryDischargeControlStateId: strField(c, WB_EVCC_BATTERY_DISCHARGE_CONTROL),
		connectionStateId: strField(c, WB_EVCC_CONNECTION),
		vehicleRangeKmStateId: strField(c, WB_EVCC_VEHICLE_RANGE),
		vehicleOdometerKmStateId: strField(c, WB_EVCC_VEHICLE_ODOMETER),
		chargeRemainingDurationSStateId: strField(c, WB_EVCC_CHARGE_REMAINING_DURATION),
		effectiveMaxCurrentAStateId: strField(c, WB_EVCC_EFFECTIVE_MAX_CURRENT),
		effectiveMinCurrentAStateId: strField(c, WB_EVCC_EFFECTIVE_MIN_CURRENT),
		offeredCurrentAStateId: strField(c, WB_EVCC_OFFERED_CURRENT),
		chargeCurrentsStateId: strField(c, WB_EVCC_CHARGE_CURRENTS),
		chargeVoltagesStateId: strField(c, WB_EVCC_CHARGE_VOLTAGES),
		sessionPriceStateId: strField(c, WB_EVCC_SESSION_PRICE),
		sessionPricePerKwhStateId: strField(c, WB_EVCC_SESSION_PRICE_PER_KWH),
		vehicleDetectionActiveStateId: strField(c, WB_EVCC_VEHICLE_DETECTION_ACTIVE),
		smartCostLimitStateId: strField(c, WB_EVCC_SMART_COST_LIMIT),
		smartCostActiveStateId: strField(c, WB_EVCC_SMART_COST_ACTIVE),
	};
}

export function wallboxHoldSignalConfigFromAdapter(config: unknown): WallboxHoldSignalConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	return {
		externalVehicleChargeStateId: strField(c, WB_EXTERNAL_VEHICLE_CHARGE),
		tibberGridRewardsActiveStateId: strField(c, WB_TIBBER_GRID_REWARDS_ACTIVE),
	};
}

export function configuredWallboxHoldSignalStateIds(cfg: WallboxHoldSignalConfig): string[] {
	const ids: string[] = [];
	if (cfg.externalVehicleChargeStateId) ids.push(cfg.externalVehicleChargeStateId);
	if (cfg.tibberGridRewardsActiveStateId) ids.push(cfg.tibberGridRewardsActiveStateId);
	return ids;
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
	return cfg[EVCC_TELEMETRY_ROLE_CONFIG_FIELD[role]] ?? "";
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
