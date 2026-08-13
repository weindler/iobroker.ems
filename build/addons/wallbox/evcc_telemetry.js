"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyWallboxEvccTelemetryConfig = exports.evccTelemetryConfigFromAdapter = exports.readEvccTelemetrySnapshot = exports.emptyEvccTelemetrySnapshot = void 0;
const evcc_config_1 = require("./evcc_config");
Object.defineProperty(exports, "emptyWallboxEvccTelemetryConfig", { enumerable: true, get: function () { return evcc_config_1.emptyWallboxEvccTelemetryConfig; } });
const normalize_1 = require("./normalize");
const ROLE_NORMALIZER = {
    evcc_enabled: normalize_1.normalizeOptionalBool,
    evcc_connected: normalize_1.normalizeOptionalBool,
    evcc_charging: normalize_1.normalizeOptionalBool,
    evcc_charge_power_w: normalize_1.normalizeOptionalNumber,
    evcc_session_energy_kwh: normalizeSessionEnergyKwh,
    evcc_charge_remaining_energy_kwh: normalizeSessionEnergyKwh,
    evcc_vehicle_soc: normalize_1.normalizeOptionalSoc,
    evcc_vehicle_name: normalize_1.normalizeOptionalString,
    evcc_vehicle_title: normalize_1.normalizeOptionalString,
    evcc_plan_active: normalize_1.normalizeOptionalBool,
    evcc_plan_soc: normalize_1.normalizeOptionalSoc,
    evcc_plan_time: normalizePlanTime,
    evcc_effective_plan_time: normalizePlanTime,
    evcc_effective_limit_soc: normalize_1.normalizeOptionalSoc,
    evcc_battery_boost: normalize_1.normalizeOptionalBool,
    evcc_loadpoint_mode: normalize_1.normalizeOptionalLoadpointMode,
    evcc_active_phases: normalize_1.normalizeOptionalPhases,
    evcc_configured_phases: normalize_1.normalizeOptionalPhases,
    evcc_min_current_a: normalize_1.normalizeOptionalNumber,
    evcc_max_current_a: normalize_1.normalizeOptionalNumber,
    evcc_battery_mode: normalize_1.normalizeOptionalBatteryMode,
    evcc_battery_discharge_control: normalize_1.normalizeOptionalBool,
    evcc_connection: normalize_1.normalizeOptionalBool,
    evcc_vehicle_range_km: normalize_1.normalizeOptionalNumber,
    evcc_vehicle_odometer_km: normalize_1.normalizeOptionalNumber,
    evcc_charge_remaining_duration_s: normalize_1.normalizeOptionalNumber,
    evcc_effective_max_current_a: normalize_1.normalizeOptionalNumber,
    evcc_effective_min_current_a: normalize_1.normalizeOptionalNumber,
    evcc_offered_current_a: normalize_1.normalizeOptionalNumber,
    evcc_charge_currents: normalize_1.normalizeOptionalJsonString,
    evcc_charge_voltages: normalize_1.normalizeOptionalJsonString,
    evcc_session_price: normalize_1.normalizeOptionalNumber,
    evcc_session_price_per_kwh: normalize_1.normalizeOptionalNumber,
    evcc_vehicle_detection_active: normalize_1.normalizeOptionalBool,
    evcc_smart_cost_limit: normalize_1.normalizeOptionalNumber,
    evcc_smart_cost_active: normalize_1.normalizeOptionalBool,
};
/** EVCC liefert Sitzungs-/Restenergie in Wh; EMS-Light speichert kWh. */
function normalizeSessionEnergyKwh(raw) {
    const wh = (0, normalize_1.normalizeOptionalNumber)(raw);
    if (wh.status !== "valid" || wh.value === null) {
        return wh;
    }
    return { value: wh.value / 1000, status: "valid", raw };
}
/** Gos Null-Zeit (EVCC effectivePlanTime ohne Plan) ist keine gültige Deadline. */
function isZeroTimeSentinel(iso) {
    return iso.startsWith("0001-01-01T00:00:00");
}
function planTimeFromIso(iso, raw) {
    if (isZeroTimeSentinel(iso)) {
        return { value: null, status: "invalid", raw };
    }
    return { value: iso, status: "valid", raw };
}
function normalizePlanTime(raw) {
    if (raw === null || raw === undefined || raw === "") {
        return (0, normalize_1.missingField)();
    }
    if (typeof raw === "number" && Number.isFinite(raw)) {
        const ms = raw > 1e12 ? raw : raw * 1000;
        return planTimeFromIso(new Date(ms).toISOString(), raw);
    }
    const s = String(raw).trim();
    if (!s)
        return (0, normalize_1.missingField)();
    const asNum = parseFloat(s);
    if (/^\d+(\.\d+)?$/.test(s) && Number.isFinite(asNum)) {
        const ms = asNum > 1e12 ? asNum : asNum * 1000;
        return planTimeFromIso(new Date(ms).toISOString(), raw);
    }
    const parsed = Date.parse(s);
    if (Number.isFinite(parsed)) {
        return planTimeFromIso(new Date(parsed).toISOString(), raw);
    }
    return { value: null, status: "invalid", raw };
}
async function readForeign(host, objectId) {
    if (!objectId)
        return null;
    if (host.getForeignStateAsync) {
        const st = await host.getForeignStateAsync(objectId);
        if (!st || st.val === undefined)
            return null;
        return { val: st.val, ts: st.ts };
    }
    const st = await host.getStateAsync(objectId);
    if (!st || st.val === undefined)
        return null;
    return { val: st.val, ts: st.ts };
}
function emptyEvccTelemetrySnapshot(observedAt) {
    const m = () => (0, normalize_1.missingField)();
    return {
        observed_at: observedAt,
        enabled: m(),
        connected: m(),
        charging: m(),
        charge_power_w: m(),
        session_energy_kwh: m(),
        charge_remaining_energy_kwh: m(),
        vehicle_soc_pct: m(),
        vehicle_name: m(),
        vehicle_title: m(),
        plan_active: m(),
        plan_soc_pct: m(),
        plan_time: m(),
        effective_plan_time: m(),
        effective_limit_soc_pct: m(),
        battery_boost: m(),
        loadpoint_mode: m(),
        active_phases: m(),
        configured_phases: m(),
        min_current_a: m(),
        max_current_a: m(),
        battery_mode: m(),
        battery_discharge_control: m(),
        connection: m(),
        vehicle_range_km: m(),
        vehicle_odometer_km: m(),
        charge_remaining_duration_s: m(),
        effective_max_current_a: m(),
        effective_min_current_a: m(),
        offered_current_a: m(),
        charge_currents_json: m(),
        charge_voltages_json: m(),
        session_price: m(),
        session_price_per_kwh: m(),
        vehicle_detection_active: m(),
        smart_cost_limit: m(),
        smart_cost_active: m(),
    };
}
exports.emptyEvccTelemetrySnapshot = emptyEvccTelemetrySnapshot;
async function readEvccTelemetrySnapshot(host, cfg, now) {
    const observedAt = now.toISOString();
    const ids = (0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg);
    if (ids.length === 0) {
        return emptyEvccTelemetrySnapshot(observedAt);
    }
    const fields = {};
    for (const role of Object.keys(ROLE_NORMALIZER)) {
        const stateId = (0, evcc_config_1.stateIdForRole)(cfg, role);
        if (!stateId) {
            fields[role] = (0, normalize_1.missingField)();
            continue;
        }
        const st = await readForeign(host, stateId);
        if (!st) {
            fields[role] = (0, normalize_1.missingField)();
            continue;
        }
        fields[role] = ROLE_NORMALIZER[role](st.val);
    }
    return {
        observed_at: observedAt,
        enabled: fields.evcc_enabled,
        connected: fields.evcc_connected,
        charging: fields.evcc_charging,
        charge_power_w: fields.evcc_charge_power_w,
        session_energy_kwh: fields.evcc_session_energy_kwh,
        charge_remaining_energy_kwh: fields.evcc_charge_remaining_energy_kwh,
        vehicle_soc_pct: fields.evcc_vehicle_soc,
        vehicle_name: fields.evcc_vehicle_name,
        vehicle_title: fields.evcc_vehicle_title,
        plan_active: fields.evcc_plan_active,
        plan_soc_pct: fields.evcc_plan_soc,
        plan_time: fields.evcc_plan_time,
        effective_plan_time: fields.evcc_effective_plan_time,
        effective_limit_soc_pct: fields.evcc_effective_limit_soc,
        battery_boost: fields.evcc_battery_boost,
        loadpoint_mode: fields.evcc_loadpoint_mode,
        active_phases: fields.evcc_active_phases,
        configured_phases: fields.evcc_configured_phases,
        min_current_a: fields.evcc_min_current_a,
        max_current_a: fields.evcc_max_current_a,
        battery_mode: fields.evcc_battery_mode,
        battery_discharge_control: fields.evcc_battery_discharge_control,
        connection: fields.evcc_connection,
        vehicle_range_km: fields.evcc_vehicle_range_km,
        vehicle_odometer_km: fields.evcc_vehicle_odometer_km,
        charge_remaining_duration_s: fields.evcc_charge_remaining_duration_s,
        effective_max_current_a: fields.evcc_effective_max_current_a,
        effective_min_current_a: fields.evcc_effective_min_current_a,
        offered_current_a: fields.evcc_offered_current_a,
        charge_currents_json: fields.evcc_charge_currents,
        charge_voltages_json: fields.evcc_charge_voltages,
        session_price: fields.evcc_session_price,
        session_price_per_kwh: fields.evcc_session_price_per_kwh,
        vehicle_detection_active: fields.evcc_vehicle_detection_active,
        smart_cost_limit: fields.evcc_smart_cost_limit,
        smart_cost_active: fields.evcc_smart_cost_active,
    };
}
exports.readEvccTelemetrySnapshot = readEvccTelemetrySnapshot;
function evccTelemetryConfigFromAdapter(config) {
    return (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(config);
}
exports.evccTelemetryConfigFromAdapter = evccTelemetryConfigFromAdapter;
