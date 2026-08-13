"use strict";
/**
 * EV-foundation admin config — extends existing Wallbox/EVCC keys, no parallel addon.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveEvPlanningHints = exports.configuredExternalSourceStateIds = exports.evFoundationConfigFromAdapter = exports.normalizeChargingEfficiency = exports.parseOptionalAdminNumber = exports.WB_EXTERNAL_SMART_CHARGING_MIN_SOC_STATE = exports.WB_EXTERNAL_SOURCE_UPDATED_AT_STATE = exports.WB_EXTERNAL_SOURCE_STALE_AFTER_MIN = exports.WB_VEHICLE_CHARGE_PAUSE_STATE = exports.WB_EXTERNAL_SMART_PLAN_END_STATE = exports.WB_EXTERNAL_SMART_PLAN_START_STATE = exports.WB_EXTERNAL_TARGET_SOC_STATE = exports.WB_EXTERNAL_PLAN_DEADLINE_STATE = exports.WB_EXTERNAL_SMART_CHARGING_STATUS_STATE = exports.WB_EXTERNAL_SMART_PLAN_ENABLED_STATE = exports.WB_EXTERNAL_GRID_REWARDS_ACTIVE_STATE = exports.WB_EXTERNAL_CONTROL_ACTIVE_STATE = exports.WB_EXTERNAL_SMART_PLAN_STATE = exports.WB_HA_DATA_SOURCE_ENABLED = exports.WB_EV_AVAILABLE_UNTIL = exports.WB_EV_DEPARTURE_AT = exports.WB_EV_SAFETY_MARGIN_MIN = exports.WB_EV_CHARGING_EFFICIENCY = exports.WB_EV_MAX_AC_CHARGE_POWER_KW = exports.WB_EV_BATTERY_CAPACITY_KWH = exports.WB_EV_MINIMUM_DEPARTURE_SOC_PCT = exports.WB_EV_TARGET_SOC_PCT = exports.WB_EXTERNAL_CONTROL_TYPE = exports.WB_EXTERNAL_SMART_PLAN_AVAILABLE = exports.WB_VEHICLE_LIVE_DATA_AVAILABLE = exports.WB_TIBBER_GRID_REWARDS_WALLBOX_ENABLED = exports.WB_TIBBER_GRID_REWARDS_VEHICLE_ENABLED = exports.WB_EVCC_INTEGRATION_ENABLED = void 0;
const config_1 = require("../../../intent/config");
const evcc_config_1 = require("../evcc_config");
const lookup_1 = require("../vehicle_map/lookup");
const config_2 = require("../vehicle_map/config");
const types_1 = require("./types");
exports.WB_EVCC_INTEGRATION_ENABLED = "wb_evcc_integration_enabled";
exports.WB_TIBBER_GRID_REWARDS_VEHICLE_ENABLED = "wb_tibber_grid_rewards_vehicle_enabled";
exports.WB_TIBBER_GRID_REWARDS_WALLBOX_ENABLED = "wb_tibber_grid_rewards_wallbox_enabled";
exports.WB_VEHICLE_LIVE_DATA_AVAILABLE = "wb_vehicle_live_data_available";
exports.WB_EXTERNAL_SMART_PLAN_AVAILABLE = "wb_external_smart_plan_available";
exports.WB_EXTERNAL_CONTROL_TYPE = "wb_external_control_type";
exports.WB_EV_TARGET_SOC_PCT = "wb_ev_target_soc_pct";
exports.WB_EV_MINIMUM_DEPARTURE_SOC_PCT = "wb_ev_minimum_departure_soc_pct";
exports.WB_EV_BATTERY_CAPACITY_KWH = "wb_ev_battery_capacity_kwh";
exports.WB_EV_MAX_AC_CHARGE_POWER_KW = "wb_ev_max_ac_charge_power_kw";
exports.WB_EV_CHARGING_EFFICIENCY = "wb_ev_charging_efficiency";
exports.WB_EV_SAFETY_MARGIN_MIN = "wb_ev_safety_margin_min";
exports.WB_EV_DEPARTURE_AT = "wb_ev_departure_at";
exports.WB_EV_AVAILABLE_UNTIL = "wb_ev_available_until";
exports.WB_HA_DATA_SOURCE_ENABLED = "wb_ha_data_source_enabled";
exports.WB_EXTERNAL_SMART_PLAN_STATE = "wb_external_smart_plan_state";
exports.WB_EXTERNAL_CONTROL_ACTIVE_STATE = "wb_external_control_active_state";
exports.WB_EXTERNAL_GRID_REWARDS_ACTIVE_STATE = "wb_external_grid_rewards_active_state";
exports.WB_EXTERNAL_SMART_PLAN_ENABLED_STATE = "wb_external_smart_plan_enabled_state";
exports.WB_EXTERNAL_SMART_CHARGING_STATUS_STATE = "wb_external_smart_charging_status_state";
exports.WB_EXTERNAL_PLAN_DEADLINE_STATE = "wb_external_plan_deadline_state";
exports.WB_EXTERNAL_TARGET_SOC_STATE = "wb_external_target_soc_state";
exports.WB_EXTERNAL_SMART_PLAN_START_STATE = "wb_external_smart_plan_start_state";
exports.WB_EXTERNAL_SMART_PLAN_END_STATE = "wb_external_smart_plan_end_state";
exports.WB_VEHICLE_CHARGE_PAUSE_STATE = "wb_vehicle_charge_pause_state";
exports.WB_EXTERNAL_SOURCE_STALE_AFTER_MIN = "wb_external_source_stale_after_min";
exports.WB_EXTERNAL_SOURCE_UPDATED_AT_STATE = "wb_external_source_updated_at_state";
exports.WB_EXTERNAL_SMART_CHARGING_MIN_SOC_STATE = "wb_external_smart_charging_min_soc_state";
function strField(c, key) {
    const v = c[key];
    return typeof v === "string" ? v.trim() : "";
}
function boolField(c, key, defaultVal) {
    const v = c[key];
    if (v === true || v === 1 || v === "1" || v === "true")
        return true;
    if (v === false || v === 0 || v === "0" || v === "false")
        return false;
    return defaultVal;
}
/** Empty / whitespace / NaN → null. Never invents 0. */
function parseOptionalAdminNumber(raw) {
    if (raw === null || raw === undefined)
        return null;
    if (typeof raw === "boolean")
        return null;
    if (typeof raw === "string") {
        const s = raw.trim();
        if (!s)
            return null;
        const n = parseFloat(s.replace(",", "."));
        return Number.isFinite(n) ? n : null;
    }
    if (typeof raw === "number")
        return Number.isFinite(raw) ? raw : null;
    return null;
}
exports.parseOptionalAdminNumber = parseOptionalAdminNumber;
function optionalNumber(c, key) {
    return parseOptionalAdminNumber(c[key]);
}
function optionalString(c, key) {
    const s = strField(c, key);
    return s ? s : null;
}
function parseExternalControlType(raw) {
    const s = String(raw ?? "none").trim().toLowerCase();
    if (types_1.EV_EXTERNAL_CONTROL_TYPES.includes(s)) {
        return s;
    }
    return "none";
}
/** Efficiency: 0.5–1.0 as fraction; 50–100 as percent. Never invent a default. */
function normalizeChargingEfficiency(raw) {
    if (raw === null || !Number.isFinite(raw))
        return null;
    if (raw > 1 && raw <= 100)
        return raw / 100;
    if (raw >= 0.5 && raw <= 1)
        return raw;
    return null;
}
exports.normalizeChargingEfficiency = normalizeChargingEfficiency;
function clampSoc(raw) {
    if (raw === null || !Number.isFinite(raw))
        return null;
    if (raw < 0 || raw > 100)
        return null;
    return raw;
}
function evFoundationConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const intentAdmin = (0, config_1.intentAdminConfigFromAdapter)(c);
    const mappedCapacity = optionalNumber(c, exports.WB_EV_BATTERY_CAPACITY_KWH);
    const mappedMaxAcKw = optionalNumber(c, exports.WB_EV_MAX_AC_CHARGE_POWER_KW);
    const targetFromIntent = intentAdmin.defaultTargetSocPct;
    return {
        evccIntegrationEnabled: boolField(c, exports.WB_EVCC_INTEGRATION_ENABLED, true),
        tibberGridRewardsViaVehicleEnabled: boolField(c, exports.WB_TIBBER_GRID_REWARDS_VEHICLE_ENABLED, false),
        tibberGridRewardsViaWallboxEnabled: boolField(c, exports.WB_TIBBER_GRID_REWARDS_WALLBOX_ENABLED, false),
        vehicleLiveDataAvailable: boolField(c, exports.WB_VEHICLE_LIVE_DATA_AVAILABLE, false),
        externalSmartPlanAvailable: boolField(c, exports.WB_EXTERNAL_SMART_PLAN_AVAILABLE, false),
        externalControlType: parseExternalControlType(c[exports.WB_EXTERNAL_CONTROL_TYPE]),
        targetSocPct: clampSoc(optionalNumber(c, exports.WB_EV_TARGET_SOC_PCT) ?? targetFromIntent),
        minimumDepartureSocPct: clampSoc(optionalNumber(c, exports.WB_EV_MINIMUM_DEPARTURE_SOC_PCT)),
        batteryCapacityKWh: mappedCapacity !== null && mappedCapacity > 0 ? mappedCapacity : null,
        maxAcChargePowerKw: mappedMaxAcKw !== null && mappedMaxAcKw > 0 ? mappedMaxAcKw : null,
        chargingEfficiency: normalizeChargingEfficiency(optionalNumber(c, exports.WB_EV_CHARGING_EFFICIENCY)),
        safetyMarginMin: (() => {
            const n = optionalNumber(c, exports.WB_EV_SAFETY_MARGIN_MIN);
            return n !== null && n >= 0 ? n : null;
        })(),
        departureAt: optionalString(c, exports.WB_EV_DEPARTURE_AT),
        vehicleAvailableUntil: optionalString(c, exports.WB_EV_AVAILABLE_UNTIL),
        homeAssistantDataSourceEnabled: boolField(c, exports.WB_HA_DATA_SOURCE_ENABLED, false),
        externalSmartPlanStateId: strField(c, exports.WB_EXTERNAL_SMART_PLAN_STATE),
        externalControlActiveStateId: strField(c, exports.WB_EXTERNAL_CONTROL_ACTIVE_STATE),
        externalGridRewardsActiveStateId: strField(c, exports.WB_EXTERNAL_GRID_REWARDS_ACTIVE_STATE) || strField(c, evcc_config_1.WB_TIBBER_GRID_REWARDS_ACTIVE),
        externalSmartPlanEnabledStateId: strField(c, exports.WB_EXTERNAL_SMART_PLAN_ENABLED_STATE),
        externalSmartChargingStatusStateId: strField(c, exports.WB_EXTERNAL_SMART_CHARGING_STATUS_STATE),
        externalPlanDeadlineStateId: strField(c, exports.WB_EXTERNAL_PLAN_DEADLINE_STATE),
        externalTargetSocStateId: strField(c, exports.WB_EXTERNAL_TARGET_SOC_STATE),
        externalSmartPlanStartStateId: strField(c, exports.WB_EXTERNAL_SMART_PLAN_START_STATE),
        externalSmartPlanEndStateId: strField(c, exports.WB_EXTERNAL_SMART_PLAN_END_STATE),
        vehicleChargePauseStateId: strField(c, exports.WB_VEHICLE_CHARGE_PAUSE_STATE) || strField(c, evcc_config_1.WB_EXTERNAL_VEHICLE_CHARGE),
        externalSourceStaleAfterMin: (() => {
            const n = optionalNumber(c, exports.WB_EXTERNAL_SOURCE_STALE_AFTER_MIN);
            return n !== null && n > 0 ? n : 30;
        })(),
        externalSourceUpdatedAtStateId: strField(c, exports.WB_EXTERNAL_SOURCE_UPDATED_AT_STATE),
        externalSmartChargingMinSocStateId: strField(c, exports.WB_EXTERNAL_SMART_CHARGING_MIN_SOC_STATE),
        holdSignals: (0, evcc_config_1.wallboxHoldSignalConfigFromAdapter)(c),
    };
}
exports.evFoundationConfigFromAdapter = evFoundationConfigFromAdapter;
function configuredExternalSourceStateIds(cfg) {
    const ids = [
        cfg.externalSmartPlanStateId,
        cfg.externalControlActiveStateId,
        cfg.externalGridRewardsActiveStateId,
        cfg.externalSmartPlanEnabledStateId,
        cfg.externalSmartChargingStatusStateId,
        cfg.externalPlanDeadlineStateId,
        cfg.externalTargetSocStateId,
        cfg.externalSmartPlanStartStateId,
        cfg.externalSmartPlanEndStateId,
        cfg.vehicleChargePauseStateId,
        cfg.externalSourceUpdatedAtStateId,
        cfg.externalSmartChargingMinSocStateId,
    ];
    return [...new Set(ids.filter((id) => id.trim().length > 0))];
}
exports.configuredExternalSourceStateIds = configuredExternalSourceStateIds;
/**
 * Capacity / max AC from foundation config, else vehicle mini-map match, else null.
 * Never invents values when map and config are empty.
 */
function resolveEvPlanningHints(config, vehicleName, vehicleTitle) {
    const cfg = evFoundationConfigFromAdapter(config);
    let capacity = cfg.batteryCapacityKWh;
    let maxAcKw = cfg.maxAcChargePowerKw;
    if (capacity !== null && maxAcKw !== null) {
        return { batteryCapacityKWh: capacity, maxAcChargePowerKw: maxAcKw };
    }
    const map = (0, config_2.wallboxVehicleMapFromAdapter)(config);
    const entry = (0, lookup_1.lookupVehicleMapEntry)(map.entries, vehicleName, vehicleTitle);
    if (capacity === null && entry?.batteryCapacityNetKwh != null) {
        capacity = entry.batteryCapacityNetKwh;
    }
    if (maxAcKw === null && entry?.maxAcChargePowerW != null && entry.maxAcChargePowerW > 0) {
        maxAcKw = entry.maxAcChargePowerW / 1000;
    }
    return { batteryCapacityKWh: capacity, maxAcChargePowerKw: maxAcKw };
}
exports.resolveEvPlanningHints = resolveEvPlanningHints;
