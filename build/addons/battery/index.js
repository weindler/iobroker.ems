"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleBatteryForeignStateChange = exports.stopBatteryModule = exports.initBatteryModule = exports.BATTERY_ADDON_ID = void 0;
const mapping_sync_1 = require("../../mapping_sync");
const status_battery_1 = require("../../status_battery");
const consumption_watch_1 = require("./consumption_watch");
const ems_mirror_1 = require("./ems_mirror");
const grid_balance_runner_1 = require("./grid_balance_runner");
const mapping_config_1 = require("./mapping_config");
const winter_grid_charge_1 = require("./winter_grid_charge");
exports.BATTERY_ADDON_ID = "battery";
let winterTimer = null;
async function initBatteryModule(adapter) {
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.BATTERY_ADDON_ID, mapping_config_1.BATTERY_SONNEN_MAPPING_ROLES);
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.BATTERY_ADDON_ID, mapping_config_1.sonnenBatteryMappingFromConfig);
    await (0, ems_mirror_1.ensureBatteryEmsMirrorStates)(adapter);
    await (0, status_battery_1.ensureBatteryStatusStates)(adapter);
    const host = adapter;
    await (0, consumption_watch_1.setupConsumptionWatch)(host);
    void (0, grid_balance_runner_1.runGridBalanceOnConsumptionChange)(host, "startup");
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const winterSec = (0, mapping_config_1.winterTickIntervalSecFromConfig)(cfg);
    winterTimer = setInterval(() => {
        void (0, winter_grid_charge_1.runWinterGridChargeTick)(host).catch((e) => {
            adapter.log.error(`battery winter tick: ${e}`);
        });
    }, winterSec * 1000);
    return null;
}
exports.initBatteryModule = initBatteryModule;
function stopBatteryModule(_timer) {
    if (winterTimer) {
        clearInterval(winterTimer);
        winterTimer = null;
    }
    (0, consumption_watch_1.clearConsumptionWatch)();
}
exports.stopBatteryModule = stopBatteryModule;
function handleBatteryForeignStateChange(adapter, stateId) {
    if (!(0, consumption_watch_1.isWatchedConsumptionState)(stateId)) {
        return;
    }
    (0, consumption_watch_1.onConsumptionStateChange)(adapter);
}
exports.handleBatteryForeignStateChange = handleBatteryForeignStateChange;
