"use strict";
/** Dynamischer Tarif: read-only Mess-Mapping (z. B. Tibber). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.dynamicTariffMappingFromConfig = exports.DYNAMIC_TARIFF_FLAT_PREFIX = exports.DYNAMIC_TARIFF_MAPPING_ROLES = void 0;
exports.DYNAMIC_TARIFF_MAPPING_ROLES = ["price_now_ct_per_kwh"];
exports.DYNAMIC_TARIFF_FLAT_PREFIX = {
    price_now_ct_per_kwh: "dt_price_now",
};
function dynamicTariffMappingFromConfig(config) {
    const out = {};
    for (const role of exports.DYNAMIC_TARIFF_MAPPING_ROLES) {
        const prefix = exports.DYNAMIC_TARIFF_FLAT_PREFIX[role];
        const entry = {};
        const t = config[`${prefix}_target`];
        if (typeof t === "string" && t.trim()) {
            entry.target_state = t.trim();
        }
        const en = config[`${prefix}_enabled`];
        if (typeof en === "boolean") {
            entry.enabled = en;
        }
        if (entry.target_state !== undefined || entry.enabled !== undefined) {
            out[role] = entry;
        }
    }
    return out;
}
exports.dynamicTariffMappingFromConfig = dynamicTariffMappingFromConfig;
