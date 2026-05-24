"use strict";
/** Wallbox-Befehle mit Mapping (logischer command = mapping_id). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.wallboxMappingFromConfig = exports.goeWallboxTemplateFlat = exports.WALLBOX_FLAT_PREFIX = exports.WALLBOX_MAPPING_COMMANDS = void 0;
exports.WALLBOX_MAPPING_COMMANDS = [
    "set_enabled",
    "set_current_a",
    "set_charge_power_w",
    "set_phase_switch_enabled",
];
/** Native-Keys in Instanz-Konfiguration (jsonConfig / objectId-Picker). */
exports.WALLBOX_FLAT_PREFIX = {
    set_enabled: "wb_set_enabled",
    set_current_a: "wb_set_current_a",
    set_charge_power_w: "wb_set_charge_power_w",
    set_phase_switch_enabled: "wb_set_phase_switch",
};
/** go-e-Vorlage für Admin-Button applyGoeTemplate (flache Native-Keys). */
function goeWallboxTemplateFlat() {
    return {
        wb_set_enabled_target: "go-e.0.allow_charging",
        wb_set_enabled_enabled: true,
        wb_set_enabled_allowed: "[true,false,0,1]",
        wb_set_current_a_target: "go-e.0.ampere",
        wb_set_current_a_enabled: true,
        wb_set_charge_power_w_target: "go-e.0.ampere",
        wb_set_charge_power_w_enabled: true,
        wb_set_phase_switch_target: "go-e.0.phaseSwitchModeEnabled",
        wb_set_phase_switch_enabled: true,
        wb_set_phase_switch_allowed: "[true,false]",
    };
}
exports.goeWallboxTemplateFlat = goeWallboxTemplateFlat;
function wallboxMappingFromConfig(config) {
    const nested = config.mapping?.wallbox;
    const out = {};
    for (const cmd of exports.WALLBOX_MAPPING_COMMANDS) {
        const prefix = exports.WALLBOX_FLAT_PREFIX[cmd];
        const entry = {};
        const t = config[`${prefix}_target`];
        if (typeof t === "string" && t.trim()) {
            entry.target_state = t.trim();
        }
        const en = config[`${prefix}_enabled`];
        if (typeof en === "boolean") {
            entry.enabled = en;
        }
        const av = config[`${prefix}_allowed`];
        if (typeof av === "string" && av.trim()) {
            entry.allowed_values = av.trim();
        }
        const nest = nested?.[cmd];
        if (nest && typeof nest === "object") {
            if (typeof nest.target_state === "string" && nest.target_state.trim()) {
                entry.target_state = nest.target_state.trim();
            }
            if (typeof nest.enabled === "boolean") {
                entry.enabled = nest.enabled;
            }
            if (typeof nest.allowed_values === "string" && nest.allowed_values.trim()) {
                entry.allowed_values = nest.allowed_values.trim();
            }
        }
        if (entry.target_state || entry.allowed_values || typeof entry.enabled === "boolean") {
            out[cmd] = entry;
        }
    }
    return out;
}
exports.wallboxMappingFromConfig = wallboxMappingFromConfig;
