"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasDischargeCapability = exports.hardwareLimitsFromConfig = void 0;
function num(raw) {
    if (raw === null || raw === undefined || raw === "" || typeof raw === "boolean") {
        return null;
    }
    const n = typeof raw === "number" ? raw : parseFloat(String(raw).replace(",", "."));
    return Number.isFinite(n) ? n : null;
}
/**
 * Technische Hardwaregrenzen aus der Adapter-Konfiguration.
 * Plausibilität: max_charge_w > 0, max_discharge_w >= 0,
 * 0 <= min_soc_pct < max_soc_pct <= 100.
 */
function hardwareLimitsFromConfig(config) {
    const c = (config && typeof config === "object" ? config : {});
    const maxChargeW = num(c.bat_hw_max_charge_w);
    const maxDischargeW = num(c.bat_hw_max_discharge_w);
    const minSocPct = num(c.bat_hw_min_soc_pct);
    const maxSocPct = num(c.bat_hw_max_soc_pct);
    const issues = [];
    if (maxChargeW === null || !(maxChargeW > 0)) {
        issues.push("max_charge_w_invalid");
    }
    if (maxDischargeW !== null && maxDischargeW < 0) {
        issues.push("max_discharge_w_invalid");
    }
    if (minSocPct === null || maxSocPct === null) {
        issues.push("soc_limits_missing");
    }
    else if (!(minSocPct >= 0 && minSocPct < maxSocPct && maxSocPct <= 100)) {
        issues.push("soc_limits_invalid");
    }
    return {
        maxChargeW,
        maxDischargeW,
        minSocPct,
        maxSocPct,
        valid: issues.length === 0,
        issues,
    };
}
exports.hardwareLimitsFromConfig = hardwareLimitsFromConfig;
/** Entladefähigkeit nur, wenn explizit eine positive Entladegrenze konfiguriert ist. */
function hasDischargeCapability(limits) {
    return limits.maxDischargeW !== null && limits.maxDischargeW > 0;
}
exports.hasDischargeCapability = hasDischargeCapability;
