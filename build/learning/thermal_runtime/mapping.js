"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveThermalTemperatureStateId = void 0;
const tree_paths_1 = require("../../tree_paths");
/** Admin-State oder addons.immersion_heater.mapping.buffer_temp_c — keine harte Pfad-Annahme. */
async function resolveThermalTemperatureStateId(host, configuredStateId) {
    if (configuredStateId) {
        return { stateId: configuredStateId, sourceKind: "admin" };
    }
    const base = (0, tree_paths_1.mappingBase)("immersion_heater", "buffer_temp_c");
    const enabledSt = await host.getStateAsync(`${base}.enabled`);
    if (enabledSt?.val === false) {
        return { stateId: "", sourceKind: "none" };
    }
    const targetSt = await host.getStateAsync(`${base}.target_state`);
    const targetId = typeof targetSt?.val === "string" ? targetSt.val.trim() : "";
    if (!targetId) {
        return { stateId: "", sourceKind: "none" };
    }
    return { stateId: targetId, sourceKind: "immersion_mapping" };
}
exports.resolveThermalTemperatureStateId = resolveThermalTemperatureStateId;
