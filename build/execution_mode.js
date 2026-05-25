"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureChannelTree = exports.syncExecutionModesFromConfig = exports.ensureGlobalExecutionStates = exports.isLiveWriteAllowed = exports.parseMode = void 0;
const tree_paths_1 = require("./tree_paths");
function parseMode(raw) {
    return String(raw ?? "dryrun").toLowerCase() === "live" ? "live" : "dryrun";
}
exports.parseMode = parseMode;
async function isLiveWriteAllowed(getState, addonId) {
    const global = await getState(tree_paths_1.GLOBAL.executionMode);
    if (parseMode(global?.val) !== "live") {
        return false;
    }
    const addon = await getState((0, tree_paths_1.addonMode)(addonId));
    return parseMode(addon?.val) === "live";
}
exports.isLiveWriteAllowed = isLiveWriteAllowed;
async function ensureGlobalExecutionStates(host) {
    await host.setObjectNotExistsAsync(tree_paths_1.GLOBAL.executionMode, {
        type: "state",
        common: {
            name: "Global: Ausführung (dryrun|live)",
            type: "string",
            role: "text",
            read: true,
            write: true,
            def: "dryrun",
        },
        native: {},
    });
    const cur = await host.getStateAsync(tree_paths_1.GLOBAL.executionMode);
    if (cur?.val === undefined || cur.val === null || cur.val === "") {
        await host.setStateAsync(tree_paths_1.GLOBAL.executionMode, { val: "dryrun", ack: true });
    }
}
exports.ensureGlobalExecutionStates = ensureGlobalExecutionStates;
async function syncExecutionModesFromConfig(host, config) {
    const c = config;
    const globalMode = parseMode(c.global_execution_mode ?? "dryrun");
    await host.setStateAsync(tree_paths_1.GLOBAL.executionMode, { val: globalMode, ack: true });
    const wb = parseMode(c.wb_addon_mode ?? "dryrun");
    await host.setStateAsync((0, tree_paths_1.addonMode)("wallbox"), { val: wb, ack: true });
    const bat = parseMode(c.bat_addon_mode ?? "dryrun");
    await host.setStateAsync((0, tree_paths_1.addonMode)("battery"), { val: bat, ack: true });
}
exports.syncExecutionModesFromConfig = syncExecutionModesFromConfig;
async function ensureChannelTree(setObjectNotExistsAsync) {
    const channels = [
        { id: "global", name: "Global" },
        { id: "ems_mirror", name: "EMS Spiegel (read/write von EMS)" },
        { id: "command", name: "Befehle (Inbox)" },
        { id: "audit", name: "Audit" },
        { id: "addons", name: "Addons" },
        { id: "addons.wallbox", name: "Wallbox" },
        { id: "addons.battery", name: "Batterie" },
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
