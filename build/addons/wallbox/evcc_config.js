"use strict";
/** EVCC read-only telemetry config (Phase 3B.1). Intent fields stay on intent_evcc_* keys. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasLegacyWallboxWriteMapping = exports.wallboxEvccTelemetryMappingFromConfig = exports.stateIdForRole = exports.configuredEvccTelemetryStateIds = exports.configuredWallboxHoldSignalStateIds = exports.wallboxHoldSignalConfigFromAdapter = exports.wallboxEvccTelemetryConfigFromAdapter = exports.emptyWallboxEvccTelemetryConfig = exports.EVCC_TELEMETRY_ROLE_CONFIG_FIELD = exports.WB_LEGACY_VEHICLE_SOC = exports.WALLBOX_EVCC_TELEMETRY_ROLES = exports.WB_TIBBER_GRID_REWARDS_ACTIVE = exports.WB_EXTERNAL_VEHICLE_CHARGE = exports.WB_EVCC_SMART_COST_ACTIVE = exports.WB_EVCC_SMART_COST_LIMIT = exports.WB_EVCC_VEHICLE_DETECTION_ACTIVE = exports.WB_EVCC_SESSION_PRICE_PER_KWH = exports.WB_EVCC_SESSION_PRICE = exports.WB_EVCC_CHARGE_VOLTAGES = exports.WB_EVCC_CHARGE_CURRENTS = exports.WB_EVCC_OFFERED_CURRENT = exports.WB_EVCC_EFFECTIVE_MIN_CURRENT = exports.WB_EVCC_EFFECTIVE_MAX_CURRENT = exports.WB_EVCC_CHARGE_REMAINING_DURATION = exports.WB_EVCC_VEHICLE_ODOMETER = exports.WB_EVCC_VEHICLE_RANGE = exports.WB_EVCC_CONNECTION = exports.WB_EVCC_LOADPOINT_MODE = exports.WB_EVCC_BATTERY_BOOST = exports.WB_EVCC_EFFECTIVE_LIMIT_SOC = exports.WB_EVCC_VEHICLE_TITLE = exports.WB_EVCC_VEHICLE_NAME = exports.WB_EVCC_CHARGE_REMAINING_ENERGY = exports.WB_EVCC_BATTERY_DISCHARGE_CONTROL = exports.WB_EVCC_BATTERY_MODE = exports.WB_EVCC_MAX_CURRENT_A = exports.WB_EVCC_MIN_CURRENT_A = exports.WB_EVCC_CONFIGURED_PHASES = exports.WB_EVCC_ACTIVE_PHASES = exports.WB_EVCC_EFFECTIVE_PLAN_TIME = exports.WB_EVCC_PLAN_TIME = exports.WB_EVCC_PLAN_SOC = exports.WB_EVCC_PLAN_ACTIVE = exports.WB_EVCC_VEHICLE_SOC = exports.WB_EVCC_SESSION_ENERGY_KWH = exports.WB_EVCC_CHARGE_POWER_W = exports.WB_EVCC_CHARGING = exports.WB_EVCC_CONNECTED = exports.WB_EVCC_ENABLED = void 0;
exports.WB_EVCC_ENABLED = "wb_evcc_enabled_state";
exports.WB_EVCC_CONNECTED = "wb_evcc_connected_state";
exports.WB_EVCC_CHARGING = "wb_evcc_charging_state";
exports.WB_EVCC_CHARGE_POWER_W = "wb_evcc_charge_power_w_state";
exports.WB_EVCC_SESSION_ENERGY_KWH = "wb_evcc_session_energy_kwh_state";
exports.WB_EVCC_VEHICLE_SOC = "wb_evcc_vehicle_soc_state";
exports.WB_EVCC_PLAN_ACTIVE = "wb_evcc_plan_active_state";
exports.WB_EVCC_PLAN_SOC = "wb_evcc_plan_soc_state";
exports.WB_EVCC_PLAN_TIME = "wb_evcc_plan_time_state";
exports.WB_EVCC_EFFECTIVE_PLAN_TIME = "wb_evcc_effective_plan_time_state";
exports.WB_EVCC_ACTIVE_PHASES = "wb_evcc_active_phases_state";
exports.WB_EVCC_CONFIGURED_PHASES = "wb_evcc_configured_phases_state";
exports.WB_EVCC_MIN_CURRENT_A = "wb_evcc_min_current_a_state";
exports.WB_EVCC_MAX_CURRENT_A = "wb_evcc_max_current_a_state";
exports.WB_EVCC_BATTERY_MODE = "wb_evcc_battery_mode_state";
exports.WB_EVCC_BATTERY_DISCHARGE_CONTROL = "wb_evcc_battery_discharge_control_state";
exports.WB_EVCC_CHARGE_REMAINING_ENERGY = "wb_evcc_charge_remaining_energy_state";
exports.WB_EVCC_VEHICLE_NAME = "wb_evcc_vehicle_name_state";
exports.WB_EVCC_VEHICLE_TITLE = "wb_evcc_vehicle_title_state";
exports.WB_EVCC_EFFECTIVE_LIMIT_SOC = "wb_evcc_effective_limit_soc_state";
exports.WB_EVCC_BATTERY_BOOST = "wb_evcc_battery_boost_state";
exports.WB_EVCC_LOADPOINT_MODE = "wb_evcc_loadpoint_mode_state";
exports.WB_EVCC_CONNECTION = "wb_evcc_connection_state";
exports.WB_EVCC_VEHICLE_RANGE = "wb_evcc_vehicle_range_state";
exports.WB_EVCC_VEHICLE_ODOMETER = "wb_evcc_vehicle_odometer_state";
exports.WB_EVCC_CHARGE_REMAINING_DURATION = "wb_evcc_charge_remaining_duration_state";
exports.WB_EVCC_EFFECTIVE_MAX_CURRENT = "wb_evcc_effective_max_current_state";
exports.WB_EVCC_EFFECTIVE_MIN_CURRENT = "wb_evcc_effective_min_current_state";
exports.WB_EVCC_OFFERED_CURRENT = "wb_evcc_offered_current_state";
exports.WB_EVCC_CHARGE_CURRENTS = "wb_evcc_charge_currents_state";
exports.WB_EVCC_CHARGE_VOLTAGES = "wb_evcc_charge_voltages_state";
exports.WB_EVCC_SESSION_PRICE = "wb_evcc_session_price_state";
exports.WB_EVCC_SESSION_PRICE_PER_KWH = "wb_evcc_session_price_per_kwh_state";
exports.WB_EVCC_VEHICLE_DETECTION_ACTIVE = "wb_evcc_vehicle_detection_active_state";
exports.WB_EVCC_SMART_COST_LIMIT = "wb_evcc_smart_cost_limit_state";
exports.WB_EVCC_SMART_COST_ACTIVE = "wb_evcc_smart_cost_active_state";
/** Optional foreign signals (not EVCC telemetry roles). */
exports.WB_EXTERNAL_VEHICLE_CHARGE = "wb_external_vehicle_charge_state";
exports.WB_TIBBER_GRID_REWARDS_ACTIVE = "wb_tibber_grid_rewards_active_state";
/** Synced to addons.wallbox.mapping.<role>.target_state */
exports.WALLBOX_EVCC_TELEMETRY_ROLES = [
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
];
/** @deprecated Legacy read mapping — compat only, not shown in admin. */
exports.WB_LEGACY_VEHICLE_SOC = "wb_vehicle_soc_target";
exports.EVCC_TELEMETRY_ROLE_CONFIG_FIELD = {
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
function emptyWallboxEvccTelemetryConfig() {
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
exports.emptyWallboxEvccTelemetryConfig = emptyWallboxEvccTelemetryConfig;
function strField(c, key) {
    const v = c[key];
    return typeof v === "string" ? v.trim() : "";
}
function wallboxEvccTelemetryConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const vehicleSoc = strField(c, exports.WB_EVCC_VEHICLE_SOC) || strField(c, exports.WB_LEGACY_VEHICLE_SOC);
    return {
        ...emptyWallboxEvccTelemetryConfig(),
        enabledStateId: strField(c, exports.WB_EVCC_ENABLED),
        connectedStateId: strField(c, exports.WB_EVCC_CONNECTED),
        chargingStateId: strField(c, exports.WB_EVCC_CHARGING),
        chargePowerWStateId: strField(c, exports.WB_EVCC_CHARGE_POWER_W),
        sessionEnergyKwhStateId: strField(c, exports.WB_EVCC_SESSION_ENERGY_KWH),
        chargeRemainingEnergyKwhStateId: strField(c, exports.WB_EVCC_CHARGE_REMAINING_ENERGY),
        vehicleSocStateId: vehicleSoc,
        vehicleNameStateId: strField(c, exports.WB_EVCC_VEHICLE_NAME),
        vehicleTitleStateId: strField(c, exports.WB_EVCC_VEHICLE_TITLE),
        planActiveStateId: strField(c, exports.WB_EVCC_PLAN_ACTIVE),
        planSocStateId: strField(c, exports.WB_EVCC_PLAN_SOC),
        planTimeStateId: strField(c, exports.WB_EVCC_PLAN_TIME),
        effectivePlanTimeStateId: strField(c, exports.WB_EVCC_EFFECTIVE_PLAN_TIME),
        effectiveLimitSocStateId: strField(c, exports.WB_EVCC_EFFECTIVE_LIMIT_SOC),
        batteryBoostStateId: strField(c, exports.WB_EVCC_BATTERY_BOOST),
        loadpointModeStateId: strField(c, exports.WB_EVCC_LOADPOINT_MODE),
        activePhasesStateId: strField(c, exports.WB_EVCC_ACTIVE_PHASES),
        configuredPhasesStateId: strField(c, exports.WB_EVCC_CONFIGURED_PHASES),
        minCurrentAStateId: strField(c, exports.WB_EVCC_MIN_CURRENT_A),
        maxCurrentAStateId: strField(c, exports.WB_EVCC_MAX_CURRENT_A),
        batteryModeStateId: strField(c, exports.WB_EVCC_BATTERY_MODE),
        batteryDischargeControlStateId: strField(c, exports.WB_EVCC_BATTERY_DISCHARGE_CONTROL),
        connectionStateId: strField(c, exports.WB_EVCC_CONNECTION),
        vehicleRangeKmStateId: strField(c, exports.WB_EVCC_VEHICLE_RANGE),
        vehicleOdometerKmStateId: strField(c, exports.WB_EVCC_VEHICLE_ODOMETER),
        chargeRemainingDurationSStateId: strField(c, exports.WB_EVCC_CHARGE_REMAINING_DURATION),
        effectiveMaxCurrentAStateId: strField(c, exports.WB_EVCC_EFFECTIVE_MAX_CURRENT),
        effectiveMinCurrentAStateId: strField(c, exports.WB_EVCC_EFFECTIVE_MIN_CURRENT),
        offeredCurrentAStateId: strField(c, exports.WB_EVCC_OFFERED_CURRENT),
        chargeCurrentsStateId: strField(c, exports.WB_EVCC_CHARGE_CURRENTS),
        chargeVoltagesStateId: strField(c, exports.WB_EVCC_CHARGE_VOLTAGES),
        sessionPriceStateId: strField(c, exports.WB_EVCC_SESSION_PRICE),
        sessionPricePerKwhStateId: strField(c, exports.WB_EVCC_SESSION_PRICE_PER_KWH),
        vehicleDetectionActiveStateId: strField(c, exports.WB_EVCC_VEHICLE_DETECTION_ACTIVE),
        smartCostLimitStateId: strField(c, exports.WB_EVCC_SMART_COST_LIMIT),
        smartCostActiveStateId: strField(c, exports.WB_EVCC_SMART_COST_ACTIVE),
    };
}
exports.wallboxEvccTelemetryConfigFromAdapter = wallboxEvccTelemetryConfigFromAdapter;
function wallboxHoldSignalConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    return {
        externalVehicleChargeStateId: strField(c, exports.WB_EXTERNAL_VEHICLE_CHARGE),
        tibberGridRewardsActiveStateId: strField(c, exports.WB_TIBBER_GRID_REWARDS_ACTIVE),
    };
}
exports.wallboxHoldSignalConfigFromAdapter = wallboxHoldSignalConfigFromAdapter;
function configuredWallboxHoldSignalStateIds(cfg) {
    const ids = [];
    if (cfg.externalVehicleChargeStateId)
        ids.push(cfg.externalVehicleChargeStateId);
    if (cfg.tibberGridRewardsActiveStateId)
        ids.push(cfg.tibberGridRewardsActiveStateId);
    return ids;
}
exports.configuredWallboxHoldSignalStateIds = configuredWallboxHoldSignalStateIds;
function configuredEvccTelemetryStateIds(cfg) {
    const ids = [];
    for (const role of exports.WALLBOX_EVCC_TELEMETRY_ROLES) {
        const id = stateIdForRole(cfg, role);
        if (id)
            ids.push(id);
    }
    return ids;
}
exports.configuredEvccTelemetryStateIds = configuredEvccTelemetryStateIds;
function stateIdForRole(cfg, role) {
    return cfg[exports.EVCC_TELEMETRY_ROLE_CONFIG_FIELD[role]] ?? "";
}
exports.stateIdForRole = stateIdForRole;
/** Builds addons.wallbox.mapping.* entries from flat wb_evcc_* config keys. */
function wallboxEvccTelemetryMappingFromConfig(config) {
    const cfg = wallboxEvccTelemetryConfigFromAdapter(config);
    const out = {};
    for (const role of exports.WALLBOX_EVCC_TELEMETRY_ROLES) {
        const stateId = stateIdForRole(cfg, role);
        if (stateId) {
            out[role] = { enabled: true, target_state: stateId };
        }
    }
    return out;
}
exports.wallboxEvccTelemetryMappingFromConfig = wallboxEvccTelemetryMappingFromConfig;
/** True when any legacy go-e write mapping is configured (for failsafe/pipeline guard). */
function hasLegacyWallboxWriteMapping(config) {
    const c = config && typeof config === "object" ? config : {};
    const legacyKeys = [
        "wb_set_enabled_target",
        "wb_set_current_a_target",
        "wb_set_charge_power_w_target",
        "wb_set_phase_switch_target",
    ];
    return legacyKeys.some((k) => typeof c[k] === "string" && String(c[k]).trim().length > 0);
}
exports.hasLegacyWallboxWriteMapping = hasLegacyWallboxWriteMapping;
