"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.pvShapeConfigReady = exports.pvShapeConfigFromAdapter = void 0;
function strField(config, key) {
    const v = config[key];
    return typeof v === "string" ? v.trim() : "";
}
function boolField(config, key, defaultVal) {
    const v = config[key];
    if (typeof v === "boolean")
        return v;
    if (typeof v === "number")
        return v !== 0;
    if (typeof v === "string") {
        const s = v.trim().toLowerCase();
        if (["1", "true", "on", "yes", "ja"].includes(s))
            return true;
        if (["0", "false", "off", "no", "nein"].includes(s))
            return false;
    }
    return defaultVal;
}
function pvShapeConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    return {
        enabled: boolField(c, "pv_shape_enabled", false),
        brightskyHourlyPrefix: strField(c, "pv_shape_brightsky_hourly_prefix"),
        kwpState1: strField(c, "pv_shape_kwp_state_1"),
        kwpState2: strField(c, "pv_shape_kwp_state_2"),
    };
}
exports.pvShapeConfigFromAdapter = pvShapeConfigFromAdapter;
/** Feature nur aktiv, wenn explizit aktiviert UND eine Stundenquelle konfiguriert ist. */
function pvShapeConfigReady(cfg) {
    return cfg.enabled && cfg.brightskyHourlyPrefix.trim().length > 0;
}
exports.pvShapeConfigReady = pvShapeConfigReady;
