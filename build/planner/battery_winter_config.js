"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.batteryWinterPlanConfigFromAdapter = void 0;
/** @deprecated (Roadmap Block 2) Legacy-Planner-Config — Operator-Pendant: `operator/contributions/flexible/battery_charge_logic_config.ts` (gleiche Admin-Keys, saubere Typnamen). */
const config_1 = require("../addons/battery/config");
function rec(config) {
    return config && typeof config === "object" ? config : {};
}
function num(c, key) {
    const v = c[key];
    if (v === null || v === undefined || v === "" || typeof v === "boolean")
        return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : null;
}
function intIn(c, key, def, min, max) {
    const n = num(c, key);
    if (n === null)
        return def;
    return Math.min(max, Math.max(min, Math.round(n)));
}
function floatIn(c, key, def, min, max) {
    const n = num(c, key);
    if (n === null)
        return def;
    return Math.min(max, Math.max(min, n));
}
function bool(c, key, def) {
    const v = c[key];
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
    return def;
}
/** Read-only Winter-Netzplanung — alle Schwellen aus Adapter-Config, keine fest codierten ct-Werte. */
function batteryWinterPlanConfigFromAdapter(config) {
    const c = rec(config);
    const battery = (0, config_1.batteryConfigFromAdapter)(config);
    const capManual = battery.capacityManualKwh;
    return {
        enabled: bool(c, "bat_winter_plan_enabled", true),
        horizonDays: intIn(c, "bat_winter_plan_horizon_days", 7, 1, 14),
        marginKwh: floatIn(c, "bat_winter_plan_margin_kwh", 0.5, 0, 50),
        chargeEfficiencyPct: floatIn(c, "bat_winter_charge_efficiency_pct", 92, 50, 100),
        pvRecoveryRatio: floatIn(c, "bat_winter_pv_recovery_ratio", 1.15, 1, 3),
        reserveLowConfidenceFactor: floatIn(c, "bat_winter_reserve_low_confidence_factor", 0.25, 0, 2),
        maxChargeW: battery.limits.maxChargeW ?? 0,
        maxSocPct: battery.limits.maxSocPct ?? 100,
        minSocPct: battery.limits.minSocPct ?? 0,
        capacityKwh: capManual,
    };
}
exports.batteryWinterPlanConfigFromAdapter = batteryWinterPlanConfigFromAdapter;
