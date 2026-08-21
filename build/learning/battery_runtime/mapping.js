"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBatteryRuntimeSources = void 0;
const mapping_resolve_1 = require("../../mapping_resolve");
const config_1 = require("../house_load/config");
function mappedTarget(host, role) {
    const mapped = (0, mapping_resolve_1.resolveMappingTargetFromConfig)(host.config, "battery", role);
    if (!mapped || !mapped.enabled) {
        return "";
    }
    return mapped.targetState;
}
/** Admin-States oder native Batterie-Mappings — keine ioBroker-Spiegel. */
async function resolveBatteryRuntimeSources(host, configured) {
    const houseLearning = (0, config_1.houseLoadConfigFromAdapter)(host.config);
    const consumptionMapped = mappedTarget(host, "consumption_w");
    return {
        socStateId: configured.socStateId || mappedTarget(host, "soc_pct"),
        capacityStateId: configured.capacityStateId || mappedTarget(host, "capacity_kwh"),
        secondsSinceFullStateId: configured.secondsSinceFullStateId || mappedTarget(host, "seconds_since_full_charge"),
        powerStateId: configured.powerStateId || mappedTarget(host, "power_w"),
        pvAcPowerStateId: mappedTarget(host, "pv_ac_power_w"),
        /** House-Load-Learning-State hat Vorrang, sonst Batterie-Mapping consumption_w. */
        consumptionStateId: houseLearning.powerStateId || consumptionMapped,
    };
}
exports.resolveBatteryRuntimeSources = resolveBatteryRuntimeSources;
