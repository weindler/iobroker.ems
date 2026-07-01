"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveBatteryRuntimeSources = void 0;
const tree_paths_1 = require("../../tree_paths");
async function resolveMappedRole(host, addonId, role) {
    const base = (0, tree_paths_1.mappingBase)(addonId, role);
    const enabledSt = await host.getStateAsync(`${base}.enabled`);
    if (enabledSt?.val === false) {
        return "";
    }
    const targetSt = await host.getStateAsync(`${base}.target_state`);
    return typeof targetSt?.val === "string" ? targetSt.val.trim() : "";
}
/** Admin-States oder addons.battery.mapping — keine harten Geräte-Pfade. */
async function resolveBatteryRuntimeSources(host, configured) {
    const socStateId = configured.socStateId || (await resolveMappedRole(host, "battery", "soc_pct"));
    const capacityStateId = configured.capacityStateId ||
        (await resolveMappedRole(host, "battery", "capacity_kwh"));
    const secondsSinceFullStateId = configured.secondsSinceFullStateId ||
        (await resolveMappedRole(host, "battery", "seconds_since_full_charge"));
    // Leistung: Admin oder addons.battery.mapping.power_w (kein charging_power_w — oft Sollwert).
    const powerStateId = configured.powerStateId || (await resolveMappedRole(host, "battery", "power_w"));
    return {
        socStateId,
        powerStateId,
        capacityStateId,
        secondsSinceFullStateId,
    };
}
exports.resolveBatteryRuntimeSources = resolveBatteryRuntimeSources;
