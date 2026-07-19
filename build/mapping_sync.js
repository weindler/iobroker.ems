"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WALLBOX_MAPPING_COMMANDS = exports.syncNativeMappingToStates = exports.ensureAddonMappingStates = void 0;
const mapping_config_1 = require("./mapping_config");
Object.defineProperty(exports, "WALLBOX_MAPPING_COMMANDS", { enumerable: true, get: function () { return mapping_config_1.WALLBOX_MAPPING_COMMANDS; } });
const tree_paths_1 = require("./tree_paths");
async function ensureAddonMappingStates(host, addonId, commands) {
    for (const cmd of commands) {
        const base = (0, tree_paths_1.mappingBase)(addonId, cmd);
        await host.setObjectNotExistsAsync(`${base}.enabled`, {
            type: "state",
            common: {
                name: `${addonId} ${cmd} mapping enabled`,
                type: "boolean",
                role: "switch",
                read: true,
                write: true,
                def: true,
            },
            native: {},
        });
        await host.setObjectNotExistsAsync(`${base}.target_state`, {
            type: "state",
            common: {
                name: `${addonId} ${cmd} target state id`,
                type: "string",
                role: "text",
                read: true,
                write: true,
            },
            native: {},
        });
        await host.setObjectNotExistsAsync(`${base}.allowed_values`, {
            type: "state",
            common: {
                name: `${addonId} ${cmd} allowed values (JSON array)`,
                type: "string",
                role: "json",
                read: true,
                write: true,
            },
            native: {},
        });
    }
}
exports.ensureAddonMappingStates = ensureAddonMappingStates;
/** Instanz-native (jsonConfig) → mapping.* States nach Adapter-Start. */
async function syncNativeMappingToStates(host, addonId, fromConfig) {
    const cfg = host.config;
    if (!cfg || typeof cfg !== "object") {
        return;
    }
    const entries = fromConfig(cfg);
    for (const [cmd, entry] of Object.entries(entries)) {
        await applyMappingEntry(host, addonId, cmd, entry);
    }
}
exports.syncNativeMappingToStates = syncNativeMappingToStates;
async function applyMappingEntry(host, addonId, cmd, entry) {
    const base = (0, tree_paths_1.mappingBase)(addonId, cmd);
    const hostWithObj = host;
    const objectExists = async (id) => {
        if (typeof hostWithObj.getObjectAsync !== "function") {
            return true;
        }
        const obj = await hostWithObj.getObjectAsync(id);
        return Boolean(obj);
    };
    if (typeof entry.enabled === "boolean") {
        const id = `${base}.enabled`;
        if (await objectExists(id)) {
            await host.setStateAsync(id, { val: entry.enabled, ack: true });
        }
    }
    const ts = entry.target_state;
    if (typeof ts === "string" && ts.trim()) {
        const id = `${base}.target_state`;
        if (await objectExists(id)) {
            await host.setStateAsync(id, { val: ts.trim(), ack: true });
        }
    }
    const av = entry.allowed_values;
    if (typeof av === "string" && av.trim()) {
        const id = `${base}.allowed_values`;
        if (await objectExists(id)) {
            await host.setStateAsync(id, { val: av.trim(), ack: true });
        }
    }
}
