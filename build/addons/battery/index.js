"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopBatteryModule = exports.initBatteryModule = exports.BATTERY_ADDON_ID = void 0;
const mapping_sync_1 = require("../../mapping_sync");
const status_battery_1 = require("../../status_battery");
const ems_mirror_1 = require("./ems_mirror");
const mapping_config_1 = require("./mapping_config");
const tick_1 = require("./tick");
exports.BATTERY_ADDON_ID = "battery";
async function initBatteryModule(adapter) {
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.BATTERY_ADDON_ID, mapping_config_1.BATTERY_SONNEN_MAPPING_ROLES);
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.BATTERY_ADDON_ID, mapping_config_1.sonnenBatteryMappingFromConfig);
    await (0, ems_mirror_1.ensureBatteryEmsMirrorStates)(adapter);
    await (0, status_battery_1.ensureBatteryStatusStates)(adapter);
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    const intervalSec = (0, mapping_config_1.tickIntervalSecFromConfig)(cfg);
    const host = adapter;
    const tick = () => {
        void (0, tick_1.runBatteryGridBalanceTick)(host).catch((e) => {
            adapter.log.error(`battery grid_balance tick: ${e}`);
        });
    };
    tick();
    return setInterval(tick, intervalSec * 1000);
}
exports.initBatteryModule = initBatteryModule;
function stopBatteryModule(timer) {
    if (timer) {
        clearInterval(timer);
    }
}
exports.stopBatteryModule = stopBatteryModule;
