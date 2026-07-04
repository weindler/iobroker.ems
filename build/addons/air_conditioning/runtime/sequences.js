"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeAcWriteSteps = exports.scheduleToggleMirrorReset = exports.resetToggleMirrorsNow = exports.buildAcMappingTableFromStates = exports.buildAcMappingTableFromConfig = exports.collectToggleMirrorIds = exports.resolveAcMappingTarget = void 0;
const device_write_1 = require("../../../device_write");
const tree_paths_1 = require("../../../tree_paths");
const constants_1 = require("../constants");
const mapping_config_1 = require("../mapping_config");
const SAMSUNG_TOGGLE_ROLES = ["cmd_switch_on", "cmd_switch_off", "cmd_refresh"];
/** Nach switch-off auch switch-on zurücksetzen (und umgekehrt) — hängen sonst auf ON. */
const TOGGLE_CROSS_RESET = {
    cmd_switch_on: ["cmd_switch_off"],
    cmd_switch_off: ["cmd_switch_on"],
};
function resolveAcMappingTarget(table, unitIndex, role) {
    const cmd = (0, constants_1.acUnitMappingCommand)(unitIndex, role);
    const entry = table[cmd];
    if (!entry?.enabled || !entry.targetStateId.trim()) {
        return "";
    }
    return entry.targetStateId.trim();
}
exports.resolveAcMappingTarget = resolveAcMappingTarget;
function collectToggleMirrorIds(table, unitIndex) {
    return SAMSUNG_TOGGLE_ROLES.map((role) => resolveAcMappingTarget(table, unitIndex, role)).filter((id) => id.length > 0);
}
exports.collectToggleMirrorIds = collectToggleMirrorIds;
function buildAcMappingTableFromConfig(config) {
    const entries = (0, mapping_config_1.acMappingFromConfig)(config);
    const table = {};
    for (const [cmd, entry] of Object.entries(entries)) {
        table[cmd] = {
            enabled: entry.enabled !== false,
            targetStateId: entry.target_state ?? "",
        };
    }
    return table;
}
exports.buildAcMappingTableFromConfig = buildAcMappingTableFromConfig;
async function buildAcMappingTableFromStates(host, unitIndex, roles) {
    const table = {};
    for (const role of roles) {
        const cmd = (0, constants_1.acUnitMappingCommand)(unitIndex, role);
        const base = (0, tree_paths_1.mappingBase)(constants_1.AC_ADDON_ID, cmd);
        const enabledSt = await host.getStateAsync(`${base}.enabled`);
        const targetSt = await host.getStateAsync(`${base}.target_state`);
        table[cmd] = {
            enabled: enabledSt?.val !== false,
            targetStateId: typeof targetSt?.val === "string" ? targetSt.val.trim() : "",
        };
    }
    return table;
}
exports.buildAcMappingTableFromStates = buildAcMappingTableFromStates;
function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}
function uniqueStateIds(stateIds) {
    return [...new Set(stateIds.map((id) => id.trim()).filter(Boolean))];
}
/** Nur ioBroker-Spiegel — kein SmartThings-Befehl (ack:true). */
async function resetToggleMirrorsNow(host, stateIds, log) {
    for (const stateId of uniqueStateIds(stateIds)) {
        try {
            await host.setForeignStateAsync(stateId, { val: false, ack: true });
            log?.debug?.(`ac toggle mirror reset now: ${stateId} → false`);
        }
        catch {
            // best-effort
        }
    }
}
exports.resetToggleMirrorsNow = resetToggleMirrorsNow;
/** Verzögert nach Sequenzende — SmartThings-Adapter überschreibt oft kurz nach refresh. */
function scheduleToggleMirrorReset(host, stateIds, delayMs = constants_1.AC_TOGGLE_STATE_RESET_MS, log) {
    const unique = uniqueStateIds(stateIds);
    if (unique.length === 0) {
        return;
    }
    setTimeout(() => {
        void resetToggleMirrorsNow(host, unique, log).then(() => {
            log?.debug?.(`ac toggle mirror reset (${Math.round(delayMs / 1000)}s after sequence): ${unique.length} state(s) → false`);
        });
    }, delayMs);
}
exports.scheduleToggleMirrorReset = scheduleToggleMirrorReset;
async function pulseSmartThingsToggle(host, unitIndex, table, role, stateId, log) {
    const resetIds = [stateId];
    for (const crossRole of TOGGLE_CROSS_RESET[role] ?? []) {
        const crossId = resolveAcMappingTarget(table, unitIndex, crossRole);
        if (crossId) {
            resetIds.push(crossId);
        }
    }
    await resetToggleMirrorsNow(host, resetIds, log);
    await (0, device_write_1.writeForeignIfChanged)(host, {
        stateId,
        value: true,
        reason: `ac unit ${unitIndex} ${role}`,
        force: true,
    });
}
async function executeAcWriteSteps(host, unitIndex, table, steps, live, log) {
    let usedLiveToggle = false;
    for (const step of steps) {
        if (step.kind === "delay_ms") {
            if (live) {
                await sleep(step.ms);
            }
            continue;
        }
        const role = step.role;
        const stateId = resolveAcMappingTarget(table, unitIndex, role);
        if (!stateId) {
            log?.debug?.(`ac unit ${unitIndex}: skip unmapped role ${role}`);
            continue;
        }
        if (!live) {
            log?.debug?.(`ac dryrun unit ${unitIndex}: ${step.kind} ${role} → ${stateId}`);
            continue;
        }
        if (step.kind === "toggle") {
            usedLiveToggle = true;
            await pulseSmartThingsToggle(host, unitIndex, table, role, stateId, log);
            continue;
        }
        await (0, device_write_1.writeForeignIfChanged)(host, {
            stateId,
            value: step.value,
            reason: `ac unit ${unitIndex} ${role}`,
        });
    }
    if (live && usedLiveToggle) {
        const toggleIds = collectToggleMirrorIds(table, unitIndex);
        // Nach refresh oft erneut ON — zweimal zurücksetzen (10 s + 25 s nach Sequenzende).
        scheduleToggleMirrorReset(host, toggleIds, constants_1.AC_TOGGLE_STATE_RESET_MS, log);
        scheduleToggleMirrorReset(host, toggleIds, constants_1.AC_TOGGLE_STATE_RESET_MS * 2 + 5_000, log);
    }
}
exports.executeAcWriteSteps = executeAcWriteSteps;
