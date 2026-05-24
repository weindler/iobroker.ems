"use strict";
/** Wallbox-Befehle mit Mapping (logischer command = mapping_id). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.GOE_WALLBOX_TEMPLATE = exports.WALLBOX_MAPPING_COMMANDS = void 0;
exports.WALLBOX_MAPPING_COMMANDS = [
    "set_enabled",
    "set_current_a",
    "set_charge_power_w",
    "set_phase_switch_enabled",
];
/** Optionale go-e-Vorlage — nur per Admin-Button, nie automatisch beim Start. */
exports.GOE_WALLBOX_TEMPLATE = {
    set_enabled: {
        enabled: true,
        target_state: "go-e.0.allow_charging",
        allowed_values: "[true,false,0,1]",
    },
    set_current_a: { enabled: true, target_state: "go-e.0.ampere" },
    set_charge_power_w: { enabled: true, target_state: "go-e.0.ampere" },
    set_phase_switch_enabled: {
        enabled: true,
        target_state: "go-e.0.phaseSwitchModeEnabled",
        allowed_values: "[true,false]",
    },
};
