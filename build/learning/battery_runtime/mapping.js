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
/** Admin-States oder addons.battery.mapping (soc_pct, capacity_kwh) — keine harten Pfade. */
async function resolveBatteryRuntimeSources(host, configured) {
    const socStateId = configured.socStateId || (await resolveMappedRole(host, "battery", "soc_pct"));
    const capacityStateId = configured.capacityStateId ||
        (await resolveMappedRole(host, "battery", "capacity_kwh"));
    // Leistung: nur Admin — kein Fallback auf battery_charging_w (Schreib-Sollwert, kein Ist).
    const powerStateId = configured.powerStateId;
    return {
        socStateId,
        powerStateId,
        capacityStateId,
        secondsSinceFullStateId: configured.secondsSinceFullStateId,
    };
}
exports.resolveBatteryRuntimeSources = resolveBatteryRuntimeSources;
