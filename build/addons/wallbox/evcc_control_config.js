"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.collectConfiguredControlTargetStateIds = exports.evccModeHoldValue = exports.evccModeChargeValue = exports.evccControlTargetForRole = exports.resolveWallboxControlModel = exports.hasEvccControlWriteMapping = exports.resolveControlContractModel = exports.resolveEvccControlContractV1 = exports.matchesEvccControlSuffix = exports.strConfigField = exports.WALLBOX_EVCC_CONTROL_ROLES = exports.WALLBOX_CONTROL_MODELS = exports.WB_EVCC_MODE_HOLD_VALUE = exports.WB_EVCC_MODE_CHARGE_VALUE = exports.EVCC_BUTTON_SUFFIXES = exports.EVCC_CONTROL_V1_SUFFIXES = exports.WB_EVCC_CONTROL_NOW = exports.WB_EVCC_CONTROL_MIN = exports.WB_EVCC_CONTROL_PV = exports.WB_EVCC_CONTROL_OFF = exports.WB_EVCC_MODE_CONTROL = exports.WB_EVCC_CONTROL_PHASES_CONFIGURED = exports.WB_EVCC_CONTROL_MAX_CURRENT = exports.WB_EVCC_CONTROL_PV_CONTROL = exports.WB_EVCC_SET_PHASE = exports.WB_EVCC_SET_MAX_CURRENT_A = exports.WB_EVCC_SET_MODE = exports.WB_CONTROL_MODEL = void 0;
const evcc_config_1 = require("./evcc_config");
const mapping_config_1 = require("../../mapping_config");
/** Auswahl des Wallbox-Steuerpfads (Admin: wb_control_model). */
exports.WB_CONTROL_MODEL = "wb_control_model";
/** EVCC-Control-Write-Mappings (getrennt von Legacy wb_set_* und read-only wb_evcc_* Telemetrie). */
exports.WB_EVCC_SET_MODE = "wb_evcc_set_mode_target";
exports.WB_EVCC_SET_MAX_CURRENT_A = "wb_evcc_set_max_current_a_target";
exports.WB_EVCC_SET_PHASE = "wb_evcc_set_phase_target";
/** Future EVCC control.* contract (v0.1.272: diagnose only — not live-released). */
exports.WB_EVCC_CONTROL_PV_CONTROL = "wb_evcc_control_pv_control_target";
exports.WB_EVCC_CONTROL_MAX_CURRENT = "wb_evcc_control_max_current_target";
exports.WB_EVCC_CONTROL_PHASES_CONFIGURED = "wb_evcc_control_phases_configured_target";
/** Current EVCC ioBroker mode buttons (v0.1.274: diagnose only — not live-released). */
exports.WB_EVCC_MODE_CONTROL = "wb_evcc_mode_control";
exports.WB_EVCC_CONTROL_OFF = "wb_evcc_control_off_target";
exports.WB_EVCC_CONTROL_PV = "wb_evcc_control_pv_target";
exports.WB_EVCC_CONTROL_MIN = "wb_evcc_control_min_target";
exports.WB_EVCC_CONTROL_NOW = "wb_evcc_control_now_target";
exports.EVCC_CONTROL_V1_SUFFIXES = {
    pvControl: "control.pvControl",
    maxCurrent: "control.maxCurrent",
    phasesConfigured: "control.phasesConfigured",
};
exports.EVCC_BUTTON_SUFFIXES = {
    off: "control.off",
    pv: "control.pv",
    min: "control.min",
    now: "control.now",
};
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
function rejectDirectGoeId(stateId) {
    const id = stateId.trim();
    if (!id)
        return "";
    if (id.toLowerCase().startsWith("go-e."))
        return "";
    return id;
}
function matchesEvccControlSuffix(stateId, suffix) {
    const id = stateId.trim().replace(/\.+/g, ".").toLowerCase();
    if (!id.startsWith("evcc."))
        return false;
    const s = suffix.trim().replace(/\.+/g, ".").toLowerCase();
    return id.endsWith(`.${s}`) || id.endsWith(s);
}
exports.matchesEvccControlSuffix = matchesEvccControlSuffix;
function pickControlV1Id(c, dedicatedKey, suffix, fallbackKey) {
    const dedicated = rejectDirectGoeId(strTarget(c, dedicatedKey));
    if (dedicated && matchesEvccControlSuffix(dedicated, suffix))
        return dedicated;
    if (fallbackKey) {
        const fallback = rejectDirectGoeId(strTarget(c, fallbackKey));
        if (fallback && matchesEvccControlSuffix(fallback, suffix))
            return fallback;
    }
    return "";
}
/**
 * Structural EVCC control.* contract. Never falls back to go-e mappings.
 * Ready when all three targets are mapped; not a live-write release.
 */
function resolveEvccControlContractV1(config) {
    const c = config && typeof config === "object" ? config : {};
    const pvControlStateId = pickControlV1Id(c, exports.WB_EVCC_CONTROL_PV_CONTROL, exports.EVCC_CONTROL_V1_SUFFIXES.pvControl);
    const maxCurrentStateId = pickControlV1Id(c, exports.WB_EVCC_CONTROL_MAX_CURRENT, exports.EVCC_CONTROL_V1_SUFFIXES.maxCurrent, exports.WB_EVCC_SET_MAX_CURRENT_A);
    const phasesConfiguredStateId = pickControlV1Id(c, exports.WB_EVCC_CONTROL_PHASES_CONFIGURED, exports.EVCC_CONTROL_V1_SUFFIXES.phasesConfigured, exports.WB_EVCC_SET_PHASE);
    const missing = [];
    if (!pvControlStateId)
        missing.push(exports.EVCC_CONTROL_V1_SUFFIXES.pvControl);
    if (!maxCurrentStateId)
        missing.push(exports.EVCC_CONTROL_V1_SUFFIXES.maxCurrent);
    if (!phasesConfiguredStateId)
        missing.push(exports.EVCC_CONTROL_V1_SUFFIXES.phasesConfigured);
    return {
        pvControlStateId,
        maxCurrentStateId,
        phasesConfiguredStateId,
        ready: missing.length === 0,
        missing,
        usesLegacyGoeFallback: false,
    };
}
exports.resolveEvccControlContractV1 = resolveEvccControlContractV1;
function resolveControlContractModel(controlModel, contractV1Ready, stringModeComplete) {
    if (controlModel === "none")
        return "none";
    if (controlModel === "legacy_direct")
        return "legacy_direct";
    if (contractV1Ready)
        return "evcc_control_v1";
    if (stringModeComplete)
        return "evcc_string_mode";
    return "evcc_control_v1";
}
exports.resolveControlContractModel = resolveControlContractModel;
function hasEvccControlWriteMapping(config) {
    const c = config && typeof config === "object" ? config : {};
    const keys = [
        exports.WB_EVCC_SET_MODE,
        exports.WB_EVCC_SET_MAX_CURRENT_A,
        exports.WB_EVCC_SET_PHASE,
        exports.WB_EVCC_CONTROL_PV_CONTROL,
        exports.WB_EVCC_CONTROL_MAX_CURRENT,
        exports.WB_EVCC_CONTROL_PHASES_CONFIGURED,
        exports.WB_EVCC_CONTROL_OFF,
        exports.WB_EVCC_CONTROL_PV,
        exports.WB_EVCC_CONTROL_MIN,
        exports.WB_EVCC_CONTROL_NOW,
    ];
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
            const id = rejectDirectGoeId(evccControlTargetForRole(config, role));
            if (id)
                ids.push(id);
        }
        const contract = resolveEvccControlContractV1(config);
        for (const id of [contract.pvControlStateId, contract.maxCurrentStateId, contract.phasesConfiguredStateId]) {
            if (id)
                ids.push(id);
        }
        for (const key of [exports.WB_EVCC_CONTROL_OFF, exports.WB_EVCC_CONTROL_PV, exports.WB_EVCC_CONTROL_MIN, exports.WB_EVCC_CONTROL_NOW]) {
            const id = rejectDirectGoeId(strTarget(config, key));
            if (id)
                ids.push(id);
        }
        return [...new Set(ids)];
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
