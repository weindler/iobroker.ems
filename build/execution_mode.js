"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureChannelTree = exports.handleExecutionModeStateChange = exports.setAddonModeReplanHook = exports.isExecutionModeStateRelativeId = exports.persistExecutionModeToAdminConfig = exports.executionModeConfigKeyForRelativeId = exports.syncExecutionModesFromConfig = exports.ensureAddonExecutionModeStates = exports.ensureGlobalExecutionStates = exports.clampNativeExecutionModesDryrun = exports.NATIVE_EXECUTION_MODE_KEYS = exports.isLiveWriteAllowed = exports.executionModeCommon = exports.executionModesConfigFingerprint = exports.executionModesFromConfig = exports.isAddonExecutionOff = exports.parseMode = exports.parseAddonMode = exports.parseGlobalMode = exports.EXECUTION_MODE_CONFIG_FINGERPRINT = exports.EXECUTION_MODE_ADDON_IDS = exports.EXECUTION_MODE_STATES = exports.ADDON_EXECUTION_MODE_STATES = exports.GLOBAL_EXECUTION_MODE_STATES = exports.EXECUTION_MODE_STATE_LABELS = exports.ADDON_EXECUTION_MODE_STATE_LABELS = exports.GLOBAL_EXECUTION_MODE_STATE_LABELS = exports.EXECUTION_MODES = exports.ADDON_EXECUTION_MODES = exports.GLOBAL_EXECUTION_MODES = void 0;
const tree_paths_1 = require("./tree_paths");
exports.GLOBAL_EXECUTION_MODES = ["dryrun", "live"];
exports.ADDON_EXECUTION_MODES = ["off", "dryrun", "live"];
/** @deprecated use ADDON_EXECUTION_MODES / GLOBAL_EXECUTION_MODES */
exports.EXECUTION_MODES = exports.ADDON_EXECUTION_MODES;
exports.GLOBAL_EXECUTION_MODE_STATE_LABELS = {
    dryrun: "Dryrun (keine realen Schaltbefehle)",
    live: "Live (Writes nur für Add-ons auf Live)",
};
exports.ADDON_EXECUTION_MODE_STATE_LABELS = {
    off: "Aus (EMS-Light übernimmt nicht)",
    dryrun: "Dryrun (plant/simuliert, keine Writes)",
    live: "Live (plant und steuert bei Global Live)",
};
exports.EXECUTION_MODE_STATE_LABELS = exports.ADDON_EXECUTION_MODE_STATE_LABELS;
exports.GLOBAL_EXECUTION_MODE_STATES = {
    dryrun: exports.GLOBAL_EXECUTION_MODE_STATE_LABELS.dryrun,
    live: exports.GLOBAL_EXECUTION_MODE_STATE_LABELS.live,
};
exports.ADDON_EXECUTION_MODE_STATES = {
    off: exports.ADDON_EXECUTION_MODE_STATE_LABELS.off,
    dryrun: exports.ADDON_EXECUTION_MODE_STATE_LABELS.dryrun,
    live: exports.ADDON_EXECUTION_MODE_STATE_LABELS.live,
};
/** @deprecated use ADDON_EXECUTION_MODE_STATES for addon objects */
exports.EXECUTION_MODE_STATES = exports.ADDON_EXECUTION_MODE_STATES;
/** Addons mit off|dryrun|live-Schalter (Admin + Objektbaum). */
exports.EXECUTION_MODE_ADDON_IDS = ["wallbox", "battery", "immersion_heater", "air_conditioning"];
const ADDON_EXECUTION_MODE_NAMES = {
    wallbox: "Wallbox: Aus | Dryrun | Live",
    battery: "Batterie: Aus | Dryrun | Live",
    immersion_heater: "Heizstab: Aus | Dryrun | Live",
    air_conditioning: "Klima: Aus | Dryrun | Live",
};
/** Interner Fingerabdruck der zuletzt synchronisierten Admin-Config (nicht manuell setzen). */
exports.EXECUTION_MODE_CONFIG_FINGERPRINT = "global.execution_mode_config_fingerprint";
function parseGlobalMode(raw) {
    return String(raw ?? "dryrun").toLowerCase() === "live" ? "live" : "dryrun";
}
exports.parseGlobalMode = parseGlobalMode;
function parseAddonMode(raw) {
    const s = String(raw ?? "dryrun").toLowerCase();
    if (s === "live")
        return "live";
    if (s === "off")
        return "off";
    return "dryrun";
}
exports.parseAddonMode = parseAddonMode;
/**
 * Add-on-Modus (inkl. off). Für Global immer parseGlobalMode verwenden —
 * „off“ am Global-State wird zu dryrun geklemmt.
 */
function parseMode(raw) {
    return parseAddonMode(raw);
}
exports.parseMode = parseMode;
function isAddonExecutionOff(raw) {
    return parseAddonMode(raw) === "off";
}
exports.isAddonExecutionOff = isAddonExecutionOff;
function executionModesFromConfig(config) {
    const c = config;
    return {
        global: parseGlobalMode(c.global_execution_mode ?? "dryrun"),
        wallbox: parseAddonMode(c.wb_addon_mode ?? "dryrun"),
        battery: parseAddonMode(c.bat_addon_mode ?? "dryrun"),
        immersion_heater: parseAddonMode(c.ih_addon_mode ?? "dryrun"),
        air_conditioning: parseAddonMode(c.ac_addon_mode ?? "dryrun"),
    };
}
exports.executionModesFromConfig = executionModesFromConfig;
function executionModesConfigFingerprint(config) {
    return JSON.stringify(executionModesFromConfig(config));
}
exports.executionModesConfigFingerprint = executionModesConfigFingerprint;
function executionModeCommon(name, def = "dryrun", kind = "addon") {
    return {
        name,
        type: "string",
        role: "value",
        read: true,
        write: true,
        def: kind === "global" ? parseGlobalMode(def) : def,
        states: kind === "global" ? exports.GLOBAL_EXECUTION_MODE_STATES : exports.ADDON_EXECUTION_MODE_STATES,
    };
}
exports.executionModeCommon = executionModeCommon;
async function isLiveWriteAllowed(getState, addonId) {
    const global = await getState(tree_paths_1.GLOBAL.executionMode);
    if (parseGlobalMode(global?.val) !== "live") {
        return false;
    }
    const addon = await getState((0, tree_paths_1.addonMode)(addonId));
    return parseAddonMode(addon?.val) === "live";
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
function hasGlobalExecutionModeValue(val) {
    const s = String(val ?? "").trim().toLowerCase();
    return s === "dryrun" || s === "live";
}
function hasAddonExecutionModeValue(val) {
    const s = String(val ?? "").trim().toLowerCase();
    return s === "off" || s === "dryrun" || s === "live";
}
function hasExecutionModeValue(val) {
    return hasAddonExecutionModeValue(val) || hasGlobalExecutionModeValue(val);
}
const ALL_DRYRUN_MODES = {
    global: "dryrun",
    wallbox: "dryrun",
    battery: "dryrun",
    immersion_heater: "dryrun",
    air_conditioning: "dryrun",
};
exports.NATIVE_EXECUTION_MODE_KEYS = [
    "global_execution_mode",
    "wb_addon_mode",
    "bat_addon_mode",
    "ih_addon_mode",
    "ac_addon_mode",
];
/** Setzt Native-Ausführungsmodi auf dryrun — übrige Native-Felder unverändert. */
function clampNativeExecutionModesDryrun(config) {
    return {
        ...config,
        global_execution_mode: "dryrun",
        wb_addon_mode: "dryrun",
        bat_addon_mode: "dryrun",
        ih_addon_mode: "dryrun",
        ac_addon_mode: "dryrun",
    };
}
exports.clampNativeExecutionModesDryrun = clampNativeExecutionModesDryrun;
async function applyExecutionModesFromConfig(host, modes) {
    await host.setStateAsync(tree_paths_1.GLOBAL.executionMode, { val: modes.global, ack: true });
    await host.setStateAsync((0, tree_paths_1.addonMode)("wallbox"), { val: modes.wallbox, ack: true });
    await host.setStateAsync((0, tree_paths_1.addonMode)("battery"), { val: modes.battery, ack: true });
    await host.setStateAsync((0, tree_paths_1.addonMode)("immersion_heater"), { val: modes.immersion_heater, ack: true });
    await host.setStateAsync((0, tree_paths_1.addonMode)("air_conditioning"), { val: modes.air_conditioning, ack: true });
}
async function anyExecutionModeEmpty(host) {
    const global = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
    if (!hasGlobalExecutionModeValue(global?.val))
        return true;
    for (const addonId of exports.EXECUTION_MODE_ADDON_IDS) {
        const cur = await host.getStateAsync((0, tree_paths_1.addonMode)(addonId));
        if (!hasAddonExecutionModeValue(cur?.val))
            return true;
    }
    return false;
}
async function mirrorGlobalExecutionSafety(host) {
    const global = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
    await host.setStateAsync("execution.safety.global_execution_mode", {
        val: parseGlobalMode(global?.val),
        ack: true,
    });
}
async function ensureGlobalExecutionStates(host) {
    await ensureExecutionModeObject(host, tree_paths_1.GLOBAL.executionMode, executionModeCommon("Global: Ausführung (dryrun|live)", "dryrun", "global"));
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
        await ensureExecutionModeObject(host, (0, tree_paths_1.addonMode)(addonId), executionModeCommon(ADDON_EXECUTION_MODE_NAMES[addonId], "dryrun", "addon"));
    }
}
exports.ensureAddonExecutionModeStates = ensureAddonExecutionModeStates;
async function alignAdminConfigWithRuntimeStates(host, config) {
    if (typeof host.updateConfig !== "function") {
        return;
    }
    const base = host.config && typeof host.config === "object"
        ? { ...host.config }
        : { ...config };
    let changed = false;
    const globalSt = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
    if (globalSt && hasGlobalExecutionModeValue(globalSt.val)) {
        const mode = parseGlobalMode(globalSt.val);
        if (parseGlobalMode(base.global_execution_mode) !== mode) {
            base.global_execution_mode = mode;
            changed = true;
        }
    }
    const addonPairs = [
        [(0, tree_paths_1.addonMode)("wallbox"), "wb_addon_mode"],
        [(0, tree_paths_1.addonMode)("battery"), "bat_addon_mode"],
        [(0, tree_paths_1.addonMode)("immersion_heater"), "ih_addon_mode"],
        [(0, tree_paths_1.addonMode)("air_conditioning"), "ac_addon_mode"],
    ];
    for (const [stateId, configKey] of addonPairs) {
        const st = await host.getStateAsync(stateId);
        if (!st || !hasAddonExecutionModeValue(st.val))
            continue;
        const mode = parseAddonMode(st.val);
        if (parseAddonMode(base[configKey]) !== mode) {
            base[configKey] = mode;
            changed = true;
        }
    }
    if (!changed) {
        return;
    }
    await host.updateConfig(base);
    await host.setStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT, {
        val: executionModesConfigFingerprint(base),
        ack: true,
    });
    host.log?.debug?.("Ausführungsmodi: Admin-Config an Objektbaum angeglichen");
}
/**
 * Admin-Config ↔ Objektbaum:
 * - Admin geändert + Speichern → Config wird auf States geschrieben
 * - Neustart ohne Admin-Änderung → Laufzeitwerte aus Objektbaum bleiben, Admin wird nachgezogen
 * - Erststart / leere States → Admin-Defaults
 */
async function syncExecutionModesFromConfig(host, config, options = {}) {
    const modes = executionModesFromConfig(config);
    const fingerprint = executionModesConfigFingerprint(config);
    const prevRaw = await host.getStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT);
    const prevFingerprint = String(prevRaw?.val ?? "");
    const empty = await anyExecutionModeEmpty(host);
    const forceReason = options.forceDryrunReason ??
        (options.coldStartRecovery ? "namespace_cold_start" : null);
    if (forceReason) {
        const dryrunNative = clampNativeExecutionModesDryrun(config);
        let nativeClamped = false;
        if (typeof host.updateConfig === "function") {
            await host.updateConfig(dryrunNative);
            nativeClamped = true;
        }
        await applyExecutionModesFromConfig(host, ALL_DRYRUN_MODES);
        await host.setStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT, {
            val: executionModesConfigFingerprint(nativeClamped ? dryrunNative : config),
            ack: true,
        });
        await mirrorGlobalExecutionSafety(host);
        if (forceReason === "restore_recovery") {
            host.log?.info?.("Restore-Recovery: Ausführungsmodi in Native und Objektbaum auf dryrun gesetzt");
        }
        else {
            host.log?.info?.(nativeClamped
                ? "Cold-Start-Recovery: Ausführungsmodi in Native und Objektbaum auf dryrun gesetzt"
                : "Cold-Start-Recovery: Ausführungsmodi auf dryrun geklemmt (Admin-Config ohne updateConfig unverändert)");
        }
        return;
    }
    if (!prevFingerprint && !empty) {
        await host.setStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT, { val: fingerprint, ack: true });
        await alignAdminConfigWithRuntimeStates(host, config);
        await mirrorGlobalExecutionSafety(host);
        host.log?.debug?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin-Fingerprint initialisiert)");
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
        host.log?.debug?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin unverändert)");
        await alignAdminConfigWithRuntimeStates(host, config);
    }
    await mirrorGlobalExecutionSafety(host);
}
exports.syncExecutionModesFromConfig = syncExecutionModesFromConfig;
function executionModeConfigKeyForRelativeId(relativeId) {
    switch (relativeId) {
        case tree_paths_1.GLOBAL.executionMode:
            return "global_execution_mode";
        case (0, tree_paths_1.addonMode)("wallbox"):
            return "wb_addon_mode";
        case (0, tree_paths_1.addonMode)("battery"):
            return "bat_addon_mode";
        case (0, tree_paths_1.addonMode)("immersion_heater"):
            return "ih_addon_mode";
        case (0, tree_paths_1.addonMode)("air_conditioning"):
            return "ac_addon_mode";
        default:
            return null;
    }
}
exports.executionModeConfigKeyForRelativeId = executionModeConfigKeyForRelativeId;
async function persistExecutionModeToAdminConfig(adapter, relativeId, mode) {
    const configKey = executionModeConfigKeyForRelativeId(relativeId);
    if (!configKey || typeof adapter.updateConfig !== "function") {
        return false;
    }
    const base = adapter.config && typeof adapter.config === "object"
        ? { ...adapter.config }
        : {};
    const next = configKey === "global_execution_mode" ? parseGlobalMode(mode) : parseAddonMode(mode);
    const prev = configKey === "global_execution_mode"
        ? parseGlobalMode(base[configKey])
        : parseAddonMode(base[configKey]);
    if (prev === next) {
        await adapter.setStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT, {
            val: executionModesConfigFingerprint(base),
            ack: true,
        });
        return false;
    }
    base[configKey] = next;
    await adapter.updateConfig(base);
    await adapter.setStateAsync(exports.EXECUTION_MODE_CONFIG_FINGERPRINT, {
        val: executionModesConfigFingerprint(base),
        ack: true,
    });
    return true;
}
exports.persistExecutionModeToAdminConfig = persistExecutionModeToAdminConfig;
function isExecutionModeStateRelativeId(relativeId) {
    if (relativeId === tree_paths_1.GLOBAL.executionMode) {
        return true;
    }
    return exports.EXECUTION_MODE_ADDON_IDS.some((addonId) => relativeId === (0, tree_paths_1.addonMode)(addonId));
}
exports.isExecutionModeStateRelativeId = isExecutionModeStateRelativeId;
let addonModeReplanHook = null;
/** Daily-Plan-Tick registriert sich hier, um bei Mode-Wechsel frisch zu replannen. */
function setAddonModeReplanHook(hook) {
    addonModeReplanHook = hook;
}
exports.setAddonModeReplanHook = setAddonModeReplanHook;
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
    const isGlobal = relativeId === tree_paths_1.GLOBAL.executionMode;
    let mode;
    if (isGlobal) {
        if (requested === "off") {
            adapter.log.warn?.(`${relativeId}: „off“ ist nur für Add-ons gültig — Global bleibt dryrun|live (Fallback dryrun)`);
            mode = "dryrun";
        }
        else {
            mode = parseGlobalMode(state.val);
            if (requested !== "" && requested !== "dryrun" && requested !== "live") {
                adapter.log.warn?.(`${relativeId}: ungültiger Wert „${state.val}“ — Fallback auf ${mode}`);
            }
        }
    }
    else {
        mode = parseAddonMode(state.val);
        if (requested !== "" && requested !== "off" && requested !== "dryrun" && requested !== "live") {
            adapter.log.warn?.(`${relativeId}: ungültiger Wert „${state.val}“ — Fallback auf ${mode}`);
        }
    }
    const prevRaw = await adapter.getStateAsync(relativeId);
    const previous = prevRaw?.val != null ? String(prevRaw.val) : null;
    await adapter.setStateAsync(relativeId, { val: mode, ack: true });
    if (isGlobal) {
        await adapter.setStateAsync("execution.safety.global_execution_mode", { val: mode, ack: true });
    }
    const adminUpdated = await persistExecutionModeToAdminConfig(adapter, relativeId, mode);
    adapter.log.info(adminUpdated
        ? `${relativeId} → ${mode} (Objektbaum, Admin übernommen)`
        : `${relativeId} → ${mode} (Objektbaum)`);
    if (addonModeReplanHook) {
        const addonId = isGlobal
            ? "global"
            : (exports.EXECUTION_MODE_ADDON_IDS.find((a) => relativeId === (0, tree_paths_1.addonMode)(a)) ?? "global");
        try {
            addonModeReplanHook({ addonId, relativeId, previous, next: mode });
        }
        catch {
            // best-effort
        }
    }
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
