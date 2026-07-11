"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectConfiguredControlTargetStateIds = exports.evccModeHoldValue = exports.evccModeChargeValue = exports.evccControlTargetForRole = exports.resolveWallboxControlModel = exports.hasEvccControlWriteMapping = exports.strConfigField = exports.WALLBOX_EVCC_CONTROL_ROLES = exports.WALLBOX_CONTROL_MODELS = exports.WB_EVCC_MODE_HOLD_VALUE = exports.WB_EVCC_MODE_CHARGE_VALUE = exports.WB_EVCC_SET_PHASE = exports.WB_EVCC_SET_MAX_CURRENT_A = exports.WB_EVCC_SET_MODE = exports.WB_CONTROL_MODEL = void 0;
const evcc_config_1 = require("./evcc_config");
const mapping_config_1 = require("../../mapping_config");
/** Auswahl des Wallbox-Steuerpfads (Admin: wb_control_model). */
exports.WB_CONTROL_MODEL = "wb_control_model";
/** EVCC-Control-Write-Mappings (getrennt von Legacy wb_set_* und read-only wb_evcc_* Telemetrie). */
exports.WB_EVCC_SET_MODE = "wb_evcc_set_mode_target";
exports.WB_EVCC_SET_MAX_CURRENT_A = "wb_evcc_set_max_current_a_target";
exports.WB_EVCC_SET_PHASE = "wb_evcc_set_phase_target";
/** Explizite Mode-Werte — keine hardcodierten Modusnamen im Runtime-Code. */
exports.WB_EVCC_MODE_CHARGE_VALUE = "wb_evcc_mode_charge_value";
exports.WB_EVCC_MODE_HOLD_VALUE = "wb_evcc_mode_hold_value";
exports.WALLBOX_CONTROL_MODELS = ["none", "evcc", "legacy_direct"];
/** EVCC-Control-Rollen — semantisch bestätigt, nicht minCurrent/enabled. */
exports.WALLBOX_EVCC_CONTROL_ROLES = ["set_mode", "set_max_current_a", "set_phase"];
function strTarget(c, key) {
    const v = c[key];
    return typeof v === "string" ? v.trim() : "";
}
function strConfigField(c, key) {
    return strTarget(c, key);
}
exports.strConfigField = strConfigField;
function hasEvccControlWriteMapping(config) {
    const c = config && typeof config === "object" ? config : {};
    const keys = [exports.WB_EVCC_SET_MODE, exports.WB_EVCC_SET_MAX_CURRENT_A, exports.WB_EVCC_SET_PHASE];
    return keys.some((k) => strTarget(c, k).length > 0);
}
exports.hasEvccControlWriteMapping = hasEvccControlWriteMapping;
function resolveWallboxControlModel(config) {
    const c = config && typeof config === "object" ? config : {};
    const explicit = c[exports.WB_CONTROL_MODEL];
    if (explicit === "none" || explicit === "evcc" || explicit === "legacy_direct") {
        return explicit;
    }
    if ((0, evcc_config_1.hasLegacyWallboxWriteMapping)(c)) {
        return "none";
    }
    return "evcc";
}
exports.resolveWallboxControlModel = resolveWallboxControlModel;
function evccControlTargetForRole(config, role) {
    const keyMap = {
        set_mode: exports.WB_EVCC_SET_MODE,
        set_max_current_a: exports.WB_EVCC_SET_MAX_CURRENT_A,
        set_phase: exports.WB_EVCC_SET_PHASE,
    };
    return strTarget(config, keyMap[role]);
}
exports.evccControlTargetForRole = evccControlTargetForRole;
function evccModeChargeValue(config) {
    return strTarget(config, exports.WB_EVCC_MODE_CHARGE_VALUE);
}
exports.evccModeChargeValue = evccModeChargeValue;
function evccModeHoldValue(config) {
    return strTarget(config, exports.WB_EVCC_MODE_HOLD_VALUE);
}
exports.evccModeHoldValue = evccModeHoldValue;
/** Sammelt konfigurierte Write-Ziel-IDs für read-only Objektprüfung (ohne Snapshot). */
function collectConfiguredControlTargetStateIds(config) {
    const model = resolveWallboxControlModel(config);
    const ids = [];
    if (model === "evcc") {
        for (const role of exports.WALLBOX_EVCC_CONTROL_ROLES) {
            const id = evccControlTargetForRole(config, role);
            if (id)
                ids.push(id);
        }
        return ids;
    }
    if (model === "legacy_direct") {
        const legacy = (0, mapping_config_1.legacyWallboxMappingFromConfig)(config);
        for (const cmd of ["set_enabled", "set_current_a", "set_charge_power_w"]) {
            const prefix = mapping_config_1.WALLBOX_FLAT_PREFIX[cmd];
            const t = legacy[cmd]?.target_state?.trim();
            const flat = typeof config[`${prefix}_target`] === "string" ? String(config[`${prefix}_target`]).trim() : "";
            const id = t || flat;
            if (id)
                ids.push(id);
        }
    }
    return ids;
}
exports.collectConfiguredControlTargetStateIds = collectConfiguredControlTargetStateIds;
