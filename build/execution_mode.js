"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureChannelTree = exports.handleExecutionModeStateChange = exports.isExecutionModeStateRelativeId = exports.syncExecutionModesFromConfig = exports.ensureAddonExecutionModeStates = exports.ensureGlobalExecutionStates = exports.isLiveWriteAllowed = exports.executionModeCommon = exports.parseMode = exports.executionModesConfigFingerprint = exports.executionModesFromConfig = exports.EXECUTION_MODE_CONFIG_FINGERPRINT = exports.EXECUTION_MODE_ADDON_IDS = exports.EXECUTION_MODE_STATES = exports.EXECUTION_MODE_STATE_LABELS = exports.EXECUTION_MODES = void 0;
const tree_paths_1 = require("./tree_paths");
exports.EXECUTION_MODES = ["dryrun", "live"];
exports.EXECUTION_MODE_STATE_LABELS = {
    dryrun: "Dryrun (kein Schreiben)",
    live: "Live (Schreiben erlaubt)",
};
exports.EXECUTION_MODE_STATES = {
    dryrun: exports.EXECUTION_MODE_STATE_LABELS.dryrun,
    live: exports.EXECUTION_MODE_STATE_LABELS.live,
};
/** Addons mit dryrun/live-Schalter (Admin + Objektbaum). */
exports.EXECUTION_MODE_ADDON_IDS = ["wallbox", "battery", "immersion_heater"];
const ADDON_EXECUTION_MODE_NAMES = {
    wallbox: "Wallbox: Ausführung (dryrun|live)",
    battery: "Batterie: Ausführung (dryrun|live)",
    immersion_heater: "Heizstab: Ausführung (dryrun|live)",
};
/** Interner Fingerabdruck der zuletzt synchronisierten Admin-Config (nicht manuell setzen). */
exports.EXECUTION_MODE_CONFIG_FINGERPRINT = "global.execution_mode_config_fingerprint";
function executionModesFromConfig(config) {
    const c = config;
    return {
        global: parseMode(c.global_execution_mode ?? "dryrun"),
        wallbox: parseMode(c.wb_addon_mode ?? "dryrun"),
        battery: parseMode(c.bat_addon_mode ?? "dryrun"),
        immersion_heater: parseMode(c.ih_addon_mode ?? "dryrun"),
    };
}
exports.executionModesFromConfig = executionModesFromConfig;
function executionModesConfigFingerprint(config) {
    return JSON.stringify(executionModesFromConfig(config));
}
exports.executionModesConfigFingerprint = executionModesConfigFingerprint;
function parseMode(raw) {
    return String(raw ?? "dryrun").toLowerCase() === "live" ? "live" : "dryrun";
}
exports.parseMode = parseMode;
function executionModeCommon(name, def = "dryrun") {
    return {
        name,
        type: "string",
        role: "value",
        read: true,
        write: true,
        def,
        states: exports.EXECUTION_MODE_STATES,
    };
}
exports.executionModeCommon = executionModeCommon;
async function isLiveWriteAllowed(getState, addonId) {
    const global = await getState(tree_paths_1.GLOBAL.executionMode);
    if (parseMode(global?.val) !== "live") {
        return false;
    }
    const addon = await getState((0, tree_paths_1.addonMode)(addonId));
    return parseMode(addon?.val) === "live";
}
exports.isLiveWriteAllowed = isLiveWriteAllowed;
async function ensureExecutionModeObject(host, id, common) {
    await host.setObjectNotExistsAsync(id, {
        type: "state",
        common,
        native: {},
    });
    if (host.extendObjectAsync) {
        await host.extendObjectAsync(id, { common });
    }
}
function hasExecutionModeValue(val) {
    const s = String(val ?? "").trim().toLowerCase();
    return s === "dryrun" || s === "live";
}
async function applyExecutionModesFromConfig(host, modes) {
    await host.setStateAsync(tree_paths_1.GLOBAL.executionMode, { val: modes.global, ack: true });
    await host.setStateAsync((0, tree_paths_1.addonMode)("wallbox"), { val: modes.wallbox, ack: true });
    await host.setStateAsync((0, tree_paths_1.addonMode)("battery"), { val: modes.battery, ack: true });
    await host.setStateAsync((0, tree_paths_1.addonMode)("immersion_heater"), { val: modes.immersion_heater, ack: true });
}
async function anyExecutionModeEmpty(host) {
    const ids = [
        tree_paths_1.GLOBAL.executionMode,
        ...exports.EXECUTION_MODE_ADDON_IDS.map((addonId) => (0, tree_paths_1.addonMode)(addonId)),
    ];
    for (const id of ids) {
        const cur = await host.getStateAsync(id);
        if (!hasExecutionModeValue(cur?.val)) {
            return true;
        }
    }
    return false;
}
async function mirrorGlobalExecutionSafety(host) {
    const global = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
    await host.setStateAsync("execution.safety.global_execution_mode", {
        val: parseMode(global?.val),
        ack: true,
    });
}
async function ensureGlobalExecutionStates(host) {
    await ensureExecutionModeObject(host, tree_paths_1.GLOBAL.executionMode, executionModeCommon("Global: Ausführung (dryrun|live)"));
    await ensureExecutionModeObject(host, exports.EXECUTION_MODE_CONFIG_FINGERPRINT, {
        name: "Intern: Admin-Fingerprint Ausführungsmodi",
        type: "string",
        role: "text",
        read: true,
        write: false,
    });
}
exports.ensureGlobalExecutionStates = ensureGlobalExecutionStates;
async function ensureAddonExecutionModeStates(host) {
    for (const addonId of exports.EXECUTION_MODE_ADDON_IDS) {
        await ensureExecutionModeObject(host, (0, tree_paths_1.addonMode)(addonId), executionModeCommon(ADDON_EXECUTION_MODE_NAMES[addonId]));
    }
}
exports.ensureAddonExecutionModeStates = ensureAddonExecutionModeStates;
/**
 * Admin-Config ↔ Objektbaum:
 * - Admin geändert + Speichern → Config wird auf States geschrieben
 * - Neustart ohne Admin-Änderung → Laufzeitwerte aus Objektbaum bleiben
 * - Erststart / leere States → Admin-Defaults
 */
async function syncExecutionModesFromConfig(host, config) {
    const modes = executionModesFromConfig(config);
    const fingerprint = executionModesConfigFingerprint(config);
    const prevRaw = await host.getStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT);
    const prevFingerprint = String(prevRaw?.val ?? "");
    const empty = await anyExecutionModeEmpty(host);
    if (!prevFingerprint && !empty) {
        // Upgrade: Laufzeitwerte schon gesetzt, Fingerabdruck fehlt — nicht überschreiben
        await host.setStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT, { val: fingerprint, ack: true });
        await mirrorGlobalExecutionSafety(host);
        host.log?.info?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin-Fingerprint initialisiert)");
        return;
    }
    if (empty || fingerprint !== prevFingerprint) {
        await applyExecutionModesFromConfig(host, modes);
        await host.setStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT, { val: fingerprint, ack: true });
        host.log?.info?.(empty
            ? "Ausführungsmodi aus Admin übernommen (Erststart)"
            : "Ausführungsmodi aus Admin übernommen (Config geändert)");
    }
    else {
        host.log?.info?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin unverändert)");
    }
    await mirrorGlobalExecutionSafety(host);
}
exports.syncExecutionModesFromConfig = syncExecutionModesFromConfig;
function isExecutionModeStateRelativeId(relativeId) {
    if (relativeId === tree_paths_1.GLOBAL.executionMode) {
        return true;
    }
    return exports.EXECUTION_MODE_ADDON_IDS.some((addonId) => relativeId === (0, tree_paths_1.addonMode)(addonId));
}
exports.isExecutionModeStateRelativeId = isExecutionModeStateRelativeId;
async function handleExecutionModeStateChange(adapter, id, state) {
    if (!state || state.ack) {
        return;
    }
    const prefix = `${adapter.namespace}.`;
    if (!id.startsWith(prefix)) {
        return;
    }
    const relativeId = id.slice(prefix.length);
    if (!isExecutionModeStateRelativeId(relativeId)) {
        return;
    }
    const requested = String(state.val ?? "").trim().toLowerCase();
    const mode = parseMode(state.val);
    if (requested !== "" && requested !== "dryrun" && requested !== "live") {
        adapter.log.warn?.(`${relativeId}: ungültiger Wert „${state.val}“ — Fallback auf ${mode}`);
    }
    await adapter.setStateAsync(relativeId, { val: mode, ack: true });
    if (relativeId === tree_paths_1.GLOBAL.executionMode) {
        await adapter.setStateAsync("execution.safety.global_execution_mode", { val: mode, ack: true });
    }
    adapter.log.info(`${relativeId} → ${mode} (Objektbaum)`);
}
exports.handleExecutionModeStateChange = handleExecutionModeStateChange;
async function ensureChannelTree(setObjectNotExistsAsync) {
    const channels = [
        { id: "global", name: "Global" },
        { id: "ems_mirror", name: "EMS Spiegel (read/write von EMS)" },
        { id: "command", name: "Befehle (Inbox)" },
        { id: "audit", name: "Audit" },
        { id: "addons", name: "Addons" },
        { id: "addons.wallbox", name: "Wallbox" },
        { id: "addons.battery", name: "Batterie" },
        { id: "addons.immersion_heater", name: "Heizstab" },
        { id: "addons.dynamic_tariff", name: "Dynamischer Tarif" },
    ];
    for (const ch of channels) {
        await setObjectNotExistsAsync(ch.id, {
            type: "channel",
            common: { name: ch.name },
            native: {},
        });
    }
}
exports.ensureChannelTree = ensureChannelTree;
