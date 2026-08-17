"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveHouseLoadPowerStateId = void 0;
const mapping_resolve_1 = require("../../mapping_resolve");
/** Admin-State oder native Batterie-Mapping consumption_w. */
async function resolveHouseLoadPowerStateId(host, configuredStateId) {
    if (configuredStateId) {
        return { stateId: configuredStateId, sourceKind: "admin" };
    }
    const mapped = (0, mapping_resolve_1.resolveMappingTargetFromConfig)(host.config, "battery", "consumption_w");
    if (!mapped || !mapped.enabled) {
        return { stateId: "", sourceKind: "none" };
    }
    return { stateId: mapped.targetState, sourceKind: "battery_mapping" };
}
exports.resolveHouseLoadPowerStateId = resolveHouseLoadPowerStateId;
