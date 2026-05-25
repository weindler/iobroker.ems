"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.immersionHeaterMappingFromConfig = exports.IMMERSION_FLAT_PREFIX = exports.IMMERSION_HEATER_MAPPING_COMMANDS = void 0;
exports.IMMERSION_HEATER_MAPPING_COMMANDS = ["set_enabled"];
exports.IMMERSION_FLAT_PREFIX = {
    set_enabled: "ih_set_enabled",
};
function immersionHeaterMappingFromConfig(config) {
    const out = {};
    for (const cmd of exports.IMMERSION_HEATER_MAPPING_COMMANDS) {
        const prefix = exports.IMMERSION_FLAT_PREFIX[cmd];
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
        if (entry.target_state !== undefined || entry.enabled !== undefined || entry.allowed_values !== undefined) {
            out[cmd] = entry;
        }
    }
    return out;
}
exports.immersionHeaterMappingFromConfig = immersionHeaterMappingFromConfig;
