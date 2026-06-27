"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isValidExternalStateId = exports.configuredEvccStateIds = exports.intentAdminConfigFromAdapter = exports.intentEvccConfigFromAdapter = void 0;
const constants_1 = require("./core/constants");
function strField(config, key) {
    const v = config[key];
    return typeof v === "string" ? v.trim() : "";
}
function numField(config, key) {
    const v = config[key];
    if (v === null || v === undefined || v === "")
        return null;
    const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", ".").trim());
    return Number.isFinite(n) ? n : null;
}
function intentEvccConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    return {
        modeStateId: strField(c, constants_1.ADMIN_INTENT_EVCC_MODE_STATE),
        targetSocStateId: strField(c, constants_1.ADMIN_INTENT_EVCC_TARGET_SOC_STATE),
        deadlineStateId: strField(c, constants_1.ADMIN_INTENT_EVCC_DEADLINE_STATE),
        immediateStateId: strField(c, constants_1.ADMIN_INTENT_EVCC_IMMEDIATE_STATE),
        sourceTimestampStateId: strField(c, constants_1.ADMIN_INTENT_EVCC_SOURCE_TIMESTAMP_STATE),
    };
}
exports.intentEvccConfigFromAdapter = intentEvccConfigFromAdapter;
const VALID_STRATEGIES = ["off", "min_pv", "pv", "immediate"];
function parseChargeStrategy(raw) {
    const s = raw.trim().toLowerCase();
    if (VALID_STRATEGIES.includes(s)) {
        return s;
    }
    return null;
}
function intentAdminConfigFromAdapter(config) {
    const c = config && typeof config === "object" ? config : {};
    const tz = strField(c, constants_1.ADMIN_INTENT_TIMEZONE) || constants_1.DEFAULT_TIMEZONE;
    const stratRaw = strField(c, constants_1.ADMIN_INTENT_DEFAULT_CHARGE_STRATEGY);
    const strat = stratRaw ? parseChargeStrategy(stratRaw) : null;
    const soc = numField(c, constants_1.ADMIN_INTENT_DEFAULT_TARGET_SOC_PCT);
    const maxMin = numField(c, constants_1.ADMIN_INTENT_MANUAL_OVERRIDE_MAX_MINUTES);
    return {
        defaultChargeStrategy: strat,
        defaultTargetSocPct: soc !== null && soc >= 0 && soc <= 100 ? soc : null,
        timezone: tz,
        manualOverrideMaxMinutes: maxMin !== null && maxMin > 0 ? maxMin : null,
    };
}
exports.intentAdminConfigFromAdapter = intentAdminConfigFromAdapter;
function configuredEvccStateIds(cfg) {
    const ids = [];
    if (cfg.modeStateId)
        ids.push(cfg.modeStateId);
    if (cfg.targetSocStateId)
        ids.push(cfg.targetSocStateId);
    if (cfg.deadlineStateId)
        ids.push(cfg.deadlineStateId);
    if (cfg.immediateStateId)
        ids.push(cfg.immediateStateId);
    if (cfg.sourceTimestampStateId)
        ids.push(cfg.sourceTimestampStateId);
    return ids;
}
exports.configuredEvccStateIds = configuredEvccStateIds;
/** Guard against accidental global mode key misuse */
function isValidExternalStateId(id) {
    return id.length > 0 && !id.startsWith("user_intent.") && !id.startsWith("policy.");
}
exports.isValidExternalStateId = isValidExternalStateId;
