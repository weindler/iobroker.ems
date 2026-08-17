"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveThermalTemperatureStateId = void 0;
const mapping_resolve_1 = require("../../mapping_resolve");
/** Admin-State oder native Heizstab-Mapping buffer_temp_c. */
async function resolveThermalTemperatureStateId(host, configuredStateId) {
    if (configuredStateId) {
        return { stateId: configuredStateId, sourceKind: "admin" };
    }
    const mapped = (0, mapping_resolve_1.resolveMappingTargetFromConfig)(host.config, "immersion_heater", "buffer_temp_c");
    if (!mapped || !mapped.enabled) {
        return { stateId: "", sourceKind: "none" };
    }
    return { stateId: mapped.targetState, sourceKind: "immersion_mapping" };
}
exports.resolveThermalTemperatureStateId = resolveThermalTemperatureStateId;
