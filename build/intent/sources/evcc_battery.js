"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readEvccBatteryIntentSnapshot = void 0;
const evcc_config_1 = require("../../addons/wallbox/evcc_config");
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
function makeField(value, status, observedAt, raw) {
    return {
        value,
        status,
        origin: { source: "evcc", owner: "evcc", change_kind: "unknown" },
        observed_at: observedAt,
        raw_value: raw,
    };
}
function parseDischargeControl(raw) {
    if (typeof raw === "boolean")
        return raw;
    if (typeof raw === "number" && Number.isFinite(raw))
        return raw !== 0;
    const s = String(raw).trim().toLowerCase();
    if (["1", "true", "on", "yes", "ja"].includes(s))
        return true;
    if (["0", "false", "off", "no", "nein"].includes(s))
        return false;
    return null;
}
function parseBatteryMode(raw) {
    if (typeof raw === "number" && Number.isFinite(raw)) {
        const map = { 0: "unknown", 1: "normal", 2: "hold", 3: "charge", 4: "holdcharge" };
        return map[raw] ?? null;
    }
    const s = String(raw).trim().toLowerCase();
    if (!s)
        return null;
    if (["normal", "hold", "charge", "holdcharge", "unknown"].includes(s))
        return s;
    return null;
}
function constraintFieldsFromMode(mode, observedAt, rawMode) {
    if (mode === "hold" || mode === "holdcharge") {
        return {
            operating_request: makeField("hold", "valid", observedAt, rawMode),
            ev_discharge_allowed: makeField(false, "valid", observedAt, rawMode),
            grid_charge_request: null,
        };
    }
    if (mode === "charge") {
        return {
            operating_request: makeField("charge", "valid", observedAt, rawMode),
            ev_discharge_allowed: null,
            grid_charge_request: makeField("allow", "valid", observedAt, rawMode),
        };
    }
    return { operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
}
async function readEvccBatteryIntentSnapshot(host, cfg, now) {
    const observedAt = now.toISOString();
    const dischargeId = (0, evcc_config_1.stateIdForRole)(cfg, "evcc_battery_discharge_control");
    const modeId = (0, evcc_config_1.stateIdForRole)(cfg, "evcc_battery_mode");
    if (!dischargeId && !modeId) {
        return { observed_at: observedAt, operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
    }
    const dischargeSt = dischargeId ? await readForeign(host, dischargeId) : null;
    const modeSt = modeId ? await readForeign(host, modeId) : null;
    const dischargeControl = dischargeSt ? parseDischargeControl(dischargeSt.val) : null;
    if (dischargeControl !== true) {
        return { observed_at: observedAt, operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
    }
    const mode = modeSt ? parseBatteryMode(modeSt.val) : null;
    if (!mode || mode === "normal" || mode === "unknown") {
        return { observed_at: observedAt, operating_request: null, ev_discharge_allowed: null, grid_charge_request: null };
    }
    const fields = constraintFieldsFromMode(mode, observedAt, modeSt?.val);
    return { observed_at: observedAt, ...fields };
}
exports.readEvccBatteryIntentSnapshot = readEvccBatteryIntentSnapshot;
