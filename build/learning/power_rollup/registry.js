"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDensePowerSources = exports.resolveBatteryPowerInvert = exports.DENSE_POWER_SOURCES = void 0;
const config_1 = require("../../addons/battery/config");
const config_2 = require("../battery_runtime/config");
const tree_paths_1 = require("../../tree_paths");
exports.DENSE_POWER_SOURCES = [
    { sourceKey: "battery.power_w", addonId: "battery", role: "power_w" },
];
async function resolveMappedRole(host, addonId, role) {
    const base = (0, tree_paths_1.mappingBase)(addonId, role);
    const enabledSt = await host.getStateAsync(`${base}.enabled`);
    if (enabledSt?.val === false) {
        return "";
    }
    const targetSt = await host.getStateAsync(`${base}.target_state`);
    return typeof targetSt?.val === "string" ? targetSt.val.trim() : "";
}
function rec(config) {
    return config && typeof config === "object" ? config : {};
}
/** EMS-Normalisierung: + laden, − entladen (Sonnen pacTotal → invert). */
function resolveBatteryPowerInvert(config) {
    const learning = (0, config_2.batteryRuntimeConfigFromAdapter)(config);
    if (learning.powerInvert) {
        return true;
    }
    const bat = (0, config_1.batteryConfigFromAdapter)(config);
    if (bat.signConvention === "positive_discharge") {
        return true;
    }
    const signRaw = String(rec(config).battery_power_sign_convention ?? "")
        .trim()
        .toLowerCase();
    if (signRaw === "") {
        return bat.profile === "sonnen_em";
    }
    return false;
}
exports.resolveBatteryPowerInvert = resolveBatteryPowerInvert;
async function resolveDensePowerSources(host) {
    const powerInvert = resolveBatteryPowerInvert(host.config);
    const learning = (0, config_2.batteryRuntimeConfigFromAdapter)(host.config);
    const out = [];
    for (const def of exports.DENSE_POWER_SOURCES) {
        let stateId = "";
        if (def.sourceKey === "battery.power_w" && learning.powerStateId) {
            stateId = learning.powerStateId;
        }
        if (!stateId) {
            stateId = await resolveMappedRole(host, def.addonId, def.role);
        }
        if (!stateId) {
            continue;
        }
        out.push({
            ...def,
            stateId,
            powerInvert,
        });
    }
    return out;
}
exports.resolveDensePowerSources = resolveDensePowerSources;
