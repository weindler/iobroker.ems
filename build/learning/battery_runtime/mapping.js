"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBatteryRuntimeSources = void 0;
const mapping_resolve_1 = require("../../mapping_resolve");
function mappedTarget(host, role) {
    const mapped = (0, mapping_resolve_1.resolveMappingTargetFromConfig)(host.config, "battery", role);
    if (!mapped || !mapped.enabled) {
        return "";
    }
    return mapped.targetState;
}
/** Admin-States oder native Batterie-Mappings — keine ioBroker-Spiegel. */
async function resolveBatteryRuntimeSources(host, configured) {
    return {
        socStateId: configured.socStateId || mappedTarget(host, "soc_pct"),
        capacityStateId: configured.capacityStateId || mappedTarget(host, "capacity_kwh"),
        secondsSinceFullStateId: configured.secondsSinceFullStateId || mappedTarget(host, "seconds_since_full_charge"),
        powerStateId: configured.powerStateId || mappedTarget(host, "power_w"),
        pvAcPowerStateId: mappedTarget(host, "pv_ac_power_w"),
        consumptionStateId: mappedTarget(host, "consumption_w"),
    };
}
exports.resolveBatteryRuntimeSources = resolveBatteryRuntimeSources;
