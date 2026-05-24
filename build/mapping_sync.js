"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncNativeMappingToStates = exports.ensureAddonMappingStates = void 0;
async function ensureAddonMappingStates(host, addonId, commands) {
    for (const cmd of commands) {
        const base = `mapping.${addonId}.${cmd}`;
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
/** Instanz-native (Admin) → mapping.* States; überschreibt nicht, wenn native leer. */
async function syncNativeMappingToStates(host, addonId) {
    const native = host.config;
    const block = native.mapping?.[addonId];
    if (!block || typeof block !== "object") {
        return;
    }
    for (const [cmd, entry] of Object.entries(block)) {
        if (!entry || typeof entry !== "object")
            continue;
        await applyMappingEntry(host, addonId, cmd, entry);
    }
}
exports.syncNativeMappingToStates = syncNativeMappingToStates;
async function applyMappingEntry(host, addonId, cmd, entry) {
    const base = `mapping.${addonId}.${cmd}`;
    if (typeof entry.enabled === "boolean") {
        await host.setStateAsync(`${base}.enabled`, { val: entry.enabled, ack: true });
    }
    const ts = entry.target_state;
    if (typeof ts === "string" && ts.trim()) {
        await host.setStateAsync(`${base}.target_state`, { val: ts.trim(), ack: true });
    }
    const av = entry.allowed_values;
    if (typeof av === "string" && av.trim()) {
        await host.setStateAsync(`${base}.allowed_values`, { val: av.trim(), ack: true });
    }
}
