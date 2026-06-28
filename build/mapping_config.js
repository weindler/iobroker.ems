"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.wallboxMappingFromConfig = exports.legacyWallboxMappingFromConfig = exports.goeWallboxTemplateFlat = exports.WALLBOX_FLAT_PREFIX_READ = exports.WALLBOX_FLAT_PREFIX = exports.WALLBOX_ALL_MAPPING_IDS = exports.WALLBOX_EVCC_TELEMETRY_ROLES = exports.WALLBOX_READ_MAPPING_ROLES = exports.WALLBOX_MAPPING_COMMANDS = exports.WALLBOX_LEGACY_MAPPING_COMMANDS = void 0;
const evcc_config_1 = require("./addons/wallbox/evcc_config");
Object.defineProperty(exports, "WALLBOX_EVCC_TELEMETRY_ROLES", { enumerable: true, get: function () { return evcc_config_1.WALLBOX_EVCC_TELEMETRY_ROLES; } });
/** @deprecated Legacy go-e write mappings — config keys preserved, not used by EVCC runtime. */
exports.WALLBOX_LEGACY_MAPPING_COMMANDS = [
    "set_enabled",
    "set_current_a",
    "set_charge_power_w",
    "set_phase_switch_enabled",
];
/** @deprecated Alias for legacy pipeline commands. */
exports.WALLBOX_MAPPING_COMMANDS = exports.WALLBOX_LEGACY_MAPPING_COMMANDS;
/** @deprecated Legacy read mapping — use evcc_vehicle_soc instead. */
exports.WALLBOX_READ_MAPPING_ROLES = ["vehicle_soc_pct"];
/** Alle Wallbox-Mapping-States unter addons.wallbox.mapping.* */
exports.WALLBOX_ALL_MAPPING_IDS = [
    ...evcc_config_1.WALLBOX_EVCC_TELEMETRY_ROLES,
    ...exports.WALLBOX_LEGACY_MAPPING_COMMANDS,
    ...exports.WALLBOX_READ_MAPPING_ROLES,
];
/** Native-Keys in Instanz-Konfiguration (jsonConfig / objectId-Picker). */
exports.WALLBOX_FLAT_PREFIX = {
    set_enabled: "wb_set_enabled",
    set_current_a: "wb_set_current_a",
    set_charge_power_w: "wb_set_charge_power_w",
    set_phase_switch_enabled: "wb_set_phase_switch",
};
exports.WALLBOX_FLAT_PREFIX_READ = {
    vehicle_soc_pct: "wb_vehicle_soc",
};
/** go-e-Vorlage für Admin-Button applyGoeTemplate (flache Native-Keys). */
function goeWallboxTemplateFlat() {
    return {
        wb_set_enabled_target: "go-e.0.allow_charging",
        wb_set_enabled_enabled: true,
        wb_set_enabled_allowed: "[true,false,0,1]",
        // amx (amperePV): RAM, für häufige Änderungen — nicht amp (Flash, ~100k Zyklen)
        wb_set_current_a_target: "go-e.0.amperePV",
        wb_set_current_a_enabled: true,
        wb_set_charge_power_w_target: "go-e.0.amperePV",
        wb_set_charge_power_w_enabled: true,
        wb_set_phase_switch_target: "go-e.0.phaseSwitchModeEnabled",
        wb_set_phase_switch_enabled: true,
        wb_set_phase_switch_allowed: "[true,false]",
    };
}
exports.goeWallboxTemplateFlat = goeWallboxTemplateFlat;
function legacyWallboxMappingFromConfig(config) {
    const nested = config.mapping?.wallbox;
    const out = {};
    for (const cmd of exports.WALLBOX_LEGACY_MAPPING_COMMANDS) {
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
    for (const role of exports.WALLBOX_READ_MAPPING_ROLES) {
        const prefix = exports.WALLBOX_FLAT_PREFIX_READ[role];
        const entry = {};
        const t = config[`${prefix}_target`];
        if (typeof t === "string" && t.trim()) {
            entry.target_state = t.trim();
        }
        const en = config[`${prefix}_enabled`];
        if (typeof en === "boolean") {
            entry.enabled = en;
        }
        const nest = nested?.[role];
        if (nest && typeof nest === "object") {
            if (typeof nest.target_state === "string" && nest.target_state.trim()) {
                entry.target_state = nest.target_state.trim();
            }
            if (typeof nest.enabled === "boolean") {
                entry.enabled = nest.enabled;
            }
        }
        if (entry.target_state || typeof entry.enabled === "boolean") {
            out[role] = entry;
        }
    }
    return out;
}
exports.legacyWallboxMappingFromConfig = legacyWallboxMappingFromConfig;
/** EVCC telemetry + legacy mappings (config keys preserved for backward compatibility). */
function wallboxMappingFromConfig(config) {
    const evcc = (0, evcc_config_1.wallboxEvccTelemetryMappingFromConfig)(config);
    const legacy = legacyWallboxMappingFromConfig(config);
    return { ...evcc, ...legacy };
}
exports.wallboxMappingFromConfig = wallboxMappingFromConfig;
