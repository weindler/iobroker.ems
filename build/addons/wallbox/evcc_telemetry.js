"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.evccTelemetryConfigFromAdapter = exports.readEvccTelemetrySnapshot = void 0;
const evcc_config_1 = require("./evcc_config");
const normalize_1 = require("./normalize");
const ROLE_NORMALIZER = {
    evcc_enabled: normalize_1.normalizeOptionalBool,
    evcc_connected: normalize_1.normalizeOptionalBool,
    evcc_charging: normalize_1.normalizeOptionalBool,
    evcc_charge_power_w: normalize_1.normalizeOptionalNumber,
    evcc_session_energy_kwh: normalizeSessionEnergyKwh,
    evcc_vehicle_soc: normalize_1.normalizeOptionalSoc,
    evcc_plan_active: normalize_1.normalizeOptionalBool,
    evcc_plan_soc: normalize_1.normalizeOptionalSoc,
    evcc_plan_time: normalizePlanTime,
    evcc_effective_plan_time: normalizePlanTime,
    evcc_active_phases: normalize_1.normalizeOptionalPhases,
    evcc_configured_phases: normalize_1.normalizeOptionalPhases,
    evcc_min_current_a: normalize_1.normalizeOptionalNumber,
    evcc_max_current_a: normalize_1.normalizeOptionalNumber,
};
/** EVCC liefert die Sitzungsenergie in Wh; EMS-Light speichert kWh. */
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
function emptySnapshot(observedAt) {
    const m = () => (0, normalize_1.missingField)();
    return {
        observed_at: observedAt,
        enabled: m(),
        connected: m(),
        charging: m(),
        charge_power_w: m(),
        session_energy_kwh: m(),
        vehicle_soc_pct: m(),
        plan_active: m(),
        plan_soc_pct: m(),
        plan_time: m(),
        effective_plan_time: m(),
        active_phases: m(),
        configured_phases: m(),
        min_current_a: m(),
        max_current_a: m(),
    };
}
async function readEvccTelemetrySnapshot(host, cfg, now) {
    const observedAt = now.toISOString();
    const ids = (0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg);
    if (ids.length === 0) {
        return emptySnapshot(observedAt);
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
        vehicle_soc_pct: fields.evcc_vehicle_soc,
        plan_active: fields.evcc_plan_active,
        plan_soc_pct: fields.evcc_plan_soc,
        plan_time: fields.evcc_plan_time,
        effective_plan_time: fields.evcc_effective_plan_time,
        active_phases: fields.evcc_active_phases,
        configured_phases: fields.evcc_configured_phases,
        min_current_a: fields.evcc_min_current_a,
        max_current_a: fields.evcc_max_current_a,
    };
}
exports.readEvccTelemetrySnapshot = readEvccTelemetrySnapshot;
function evccTelemetryConfigFromAdapter(config) {
    return (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(config);
}
exports.evccTelemetryConfigFromAdapter = evccTelemetryConfigFromAdapter;
