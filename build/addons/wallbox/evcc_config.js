"use strict";
/** EVCC read-only telemetry config (Phase 3B.1). Intent fields stay on intent_evcc_* keys. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasLegacyWallboxWriteMapping = exports.wallboxEvccTelemetryMappingFromConfig = exports.stateIdForRole = exports.configuredEvccTelemetryStateIds = exports.wallboxEvccTelemetryConfigFromAdapter = exports.WB_LEGACY_VEHICLE_SOC = exports.WALLBOX_EVCC_TELEMETRY_ROLES = exports.WB_EVCC_BATTERY_DISCHARGE_CONTROL = exports.WB_EVCC_BATTERY_MODE = exports.WB_EVCC_MAX_CURRENT_A = exports.WB_EVCC_MIN_CURRENT_A = exports.WB_EVCC_CONFIGURED_PHASES = exports.WB_EVCC_ACTIVE_PHASES = exports.WB_EVCC_EFFECTIVE_PLAN_TIME = exports.WB_EVCC_PLAN_TIME = exports.WB_EVCC_PLAN_SOC = exports.WB_EVCC_PLAN_ACTIVE = exports.WB_EVCC_VEHICLE_SOC = exports.WB_EVCC_SESSION_ENERGY_KWH = exports.WB_EVCC_CHARGE_POWER_W = exports.WB_EVCC_CHARGING = exports.WB_EVCC_CONNECTED = exports.WB_EVCC_ENABLED = void 0;
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
/** Synced to addons.wallbox.mapping.<role>.target_state */
exports.WALLBOX_EVCC_TELEMETRY_ROLES = [
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
];
/** @deprecated Legacy read mapping — compat only, not shown in admin. */
exports.WB_LEGACY_VEHICLE_SOC = "wb_vehicle_soc_target";
function strField(c, key) {
    const v = c[key];
    return typeof v === "string" ? v.trim() : "";
}
function wallboxEvccTelemetryConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const vehicleSoc = strField(c, exports.WB_EVCC_VEHICLE_SOC) || strField(c, exports.WB_LEGACY_VEHICLE_SOC);
    return {
        enabledStateId: strField(c, exports.WB_EVCC_ENABLED),
        connectedStateId: strField(c, exports.WB_EVCC_CONNECTED),
        chargingStateId: strField(c, exports.WB_EVCC_CHARGING),
        chargePowerWStateId: strField(c, exports.WB_EVCC_CHARGE_POWER_W),
        sessionEnergyKwhStateId: strField(c, exports.WB_EVCC_SESSION_ENERGY_KWH),
        vehicleSocStateId: vehicleSoc,
        planActiveStateId: strField(c, exports.WB_EVCC_PLAN_ACTIVE),
        planSocStateId: strField(c, exports.WB_EVCC_PLAN_SOC),
        planTimeStateId: strField(c, exports.WB_EVCC_PLAN_TIME),
        effectivePlanTimeStateId: strField(c, exports.WB_EVCC_EFFECTIVE_PLAN_TIME),
        activePhasesStateId: strField(c, exports.WB_EVCC_ACTIVE_PHASES),
        configuredPhasesStateId: strField(c, exports.WB_EVCC_CONFIGURED_PHASES),
        minCurrentAStateId: strField(c, exports.WB_EVCC_MIN_CURRENT_A),
        maxCurrentAStateId: strField(c, exports.WB_EVCC_MAX_CURRENT_A),
        batteryModeStateId: strField(c, exports.WB_EVCC_BATTERY_MODE),
        batteryDischargeControlStateId: strField(c, exports.WB_EVCC_BATTERY_DISCHARGE_CONTROL),
    };
}
exports.wallboxEvccTelemetryConfigFromAdapter = wallboxEvccTelemetryConfigFromAdapter;
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
