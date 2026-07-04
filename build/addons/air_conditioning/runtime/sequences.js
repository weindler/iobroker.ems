"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.executeAcWriteSteps = exports.buildAcMappingTableFromStates = exports.buildAcMappingTableFromConfig = exports.resolveAcMappingTarget = void 0;
const device_write_1 = require("../../../device_write");
const tree_paths_1 = require("../../../tree_paths");
const constants_1 = require("../constants");
const mapping_config_1 = require("../mapping_config");
function resolveAcMappingTarget(table, unitIndex, role) {
    const cmd = (0, constants_1.acUnitMappingCommand)(unitIndex, role);
    const entry = table[cmd];
    if (!entry?.enabled || !entry.targetStateId.trim()) {
        return "";
    }
    return entry.targetStateId.trim();
}
exports.resolveAcMappingTarget = resolveAcMappingTarget;
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
async function pulseSmartThingsToggle(host, unitIndex, role, stateId) {
    // Impuls-States hängen oft auf true — ioBroker-Spiegel zurück (ack:true, kein Gerätebefehl),
    // damit der folgende ack:false-Impuls beim SmartThings-Adapter ankommt.
    try {
        await host.setForeignStateAsync(stateId, { val: false, ack: true });
    }
    catch {
        // best-effort
    }
    await (0, device_write_1.writeForeignIfChanged)(host, {
        stateId,
        value: true,
        reason: `ac unit ${unitIndex} ${role}`,
        force: true,
    });
}
async function executeAcWriteSteps(host, unitIndex, table, steps, live, log) {
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
            await pulseSmartThingsToggle(host, unitIndex, role, stateId);
            continue;
        }
        await (0, device_write_1.writeForeignIfChanged)(host, {
            stateId,
            value: step.value,
            reason: `ac unit ${unitIndex} ${role}`,
        });
    }
}
exports.executeAcWriteSteps = executeAcWriteSteps;
