"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolveDensePowerSources = exports.resolveBatteryPowerInvert = exports.DENSE_POWER_SOURCES = void 0;
const config_1 = require("../../addons/battery/config");
const config_2 = require("../battery_runtime/config");
const constants_1 = require("../house_load/constants");
const config_3 = require("../house_load/config");
const history_1 = require("../house_load/history");
const tree_paths_1 = require("../../tree_paths");
const constants_2 = require("../battery_runtime/constants");
exports.DENSE_POWER_SOURCES = [
    { sourceKey: "battery.power_w", addonId: "battery", role: "power_w", rollupMode: "bidirectional_max" },
    {
        sourceKey: "battery.consumption_w",
        addonId: "battery",
        role: "consumption_w",
        rollupMode: "unidirectional_avg",
    },
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
function lookbackDaysForSource(config, def) {
    if (def.sourceKey === "battery.consumption_w") {
        const hl = (0, config_3.houseLoadConfigFromAdapter)(config);
        return hl.lookbackDays > 0 ? hl.lookbackDays : constants_1.DEFAULT_LOOKBACK_DAYS;
    }
    const br = (0, config_2.batteryRuntimeConfigFromAdapter)(config);
    return br.lookbackDays > 0 ? br.lookbackDays : constants_2.DEFAULT_LOOKBACK_DAYS;
}
async function resolvePowerUnit(host, stateId) {
    if (host.getObjectAsync) {
        return (0, history_1.resolveHouseLoadPowerUnit)(host, stateId);
    }
    return (0, history_1.detectPowerUnit)(stateId);
}
async function resolveDensePowerSources(host) {
    const powerInvert = resolveBatteryPowerInvert(host.config);
    const batteryLearning = (0, config_2.batteryRuntimeConfigFromAdapter)(host.config);
    const houseLearning = (0, config_3.houseLoadConfigFromAdapter)(host.config);
    const out = [];
    for (const def of exports.DENSE_POWER_SOURCES) {
        let stateId = "";
        if (def.sourceKey === "battery.power_w" && batteryLearning.powerStateId) {
            stateId = batteryLearning.powerStateId;
        }
        if (def.sourceKey === "battery.consumption_w" && houseLearning.powerStateId) {
            stateId = houseLearning.powerStateId;
        }
        if (!stateId) {
            stateId = await resolveMappedRole(host, def.addonId, def.role);
        }
        if (!stateId) {
            continue;
        }
        const powerUnit = def.rollupMode === "unidirectional_avg"
            ? await resolvePowerUnit(host, stateId)
            : "W";
        out.push({
            ...def,
            stateId,
            lookbackDays: lookbackDaysForSource(host.config, def),
            powerInvert: def.rollupMode === "bidirectional_max" ? powerInvert : false,
            powerUnit,
        });
    }
    return out;
}
exports.resolveDensePowerSources = resolveDensePowerSources;
