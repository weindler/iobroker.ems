"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acMappingCommandsForConfiguredUnits = exports.acMappingCommands = exports.acMappingFromConfig = exports.acMappingFlatPrefix = void 0;
const constants_1 = require("./constants");
function acMappingFlatPrefix(unitIndex, role) {
    return `ac_u${unitIndex}_${role}`;
}
exports.acMappingFlatPrefix = acMappingFlatPrefix;
function acMappingFromConfig(config) {
    const out = {};
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        for (const role of constants_1.AC_MAPPING_ROLES) {
            const prefix = acMappingFlatPrefix(i, role);
            const entry = {};
            const t = config[`${prefix}_target`];
            if (typeof t === "string" && t.trim()) {
                entry.target_state = t.trim();
            }
            const en = config[`${prefix}_enabled`];
            if (typeof en === "boolean") {
                entry.enabled = en;
            }
            const cmd = (0, constants_1.acUnitMappingCommand)(i, role);
            if (entry.target_state !== undefined || entry.enabled !== undefined) {
                out[cmd] = entry;
            }
        }
    }
    return out;
}
exports.acMappingFromConfig = acMappingFromConfig;
function acMappingCommands() {
    const cmds = [];
    for (let i = 1; i <= constants_1.AC_UNIT_COUNT; i++) {
        for (const role of constants_1.AC_MAPPING_ROLES) {
            cmds.push((0, constants_1.acUnitMappingCommand)(i, role));
        }
    }
    return cmds;
}
exports.acMappingCommands = acMappingCommands;
/** Prefer {@link acMappingCommandsForConfiguredUnits} for ensure; this remains for catalog/audit. */
var configured_1 = require("./configured");
Object.defineProperty(exports, "acMappingCommandsForConfiguredUnits", { enumerable: true, get: function () { return configured_1.acMappingCommandsForConfiguredUnits; } });
