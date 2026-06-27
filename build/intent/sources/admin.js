"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAdminIntentSnapshot = void 0;
function adminField(value, status, observedAt) {
    return {
        value,
        status,
        origin: {
            source: "admin",
            owner: "admin_config",
            change_kind: "configured",
        },
        observed_at: observedAt,
    };
}
function buildAdminIntentSnapshot(cfg, now) {
    const observedAt = now.toISOString();
    return {
        observed_at: observedAt,
        charge_strategy: cfg.defaultChargeStrategy
            ? adminField(cfg.defaultChargeStrategy, "valid", observedAt)
            : null,
        target_soc_pct: cfg.defaultTargetSocPct !== null
            ? adminField(cfg.defaultTargetSocPct, "valid", observedAt)
            : null,
        timezone: cfg.timezone,
    };
}
exports.buildAdminIntentSnapshot = buildAdminIntentSnapshot;
