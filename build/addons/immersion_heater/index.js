"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleImmersionHeaterStateChange = exports.stopImmersionHeaterModule = exports.initImmersionHeaterModule = exports.IMMERSION_ADDON_ID = void 0;
const ems_activity_1 = require("../../ems_activity");
const ems_mirror_alive_1 = require("../../ems_mirror_alive");
const mapping_sync_1 = require("../../mapping_sync");
const mapping_config_1 = require("./mapping_config");
const status_1 = require("./status");
exports.IMMERSION_ADDON_ID = "immersion_heater";
async function initImmersionHeaterModule(adapter) {
    await (0, ems_mirror_alive_1.ensureEmsMirrorAliveState)(adapter);
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.IMMERSION_ADDON_ID, mapping_config_1.IMMERSION_HEATER_MAPPING_COMMANDS);
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.IMMERSION_ADDON_ID, mapping_config_1.immersionHeaterMappingFromConfig);
    await (0, status_1.ensureImmersionStatusStates)(adapter);
    (0, ems_activity_1.touchEmsActivity)();
    adapter.log.info("immersion_heater: mapping set_enabled (failsafe via central runner)");
    return null;
}
exports.initImmersionHeaterModule = initImmersionHeaterModule;
function stopImmersionHeaterModule() {
    /* failsafe timer in failsafe_runner */
}
exports.stopImmersionHeaterModule = stopImmersionHeaterModule;
function handleImmersionHeaterStateChange(adapter, stateId) {
    const ns = `${adapter.namespace}.`;
    if ((0, ems_activity_1.isEmsActivityStateId)(stateId, ns)) {
        (0, ems_activity_1.touchEmsActivity)();
    }
}
exports.handleImmersionHeaterStateChange = handleImmersionHeaterStateChange;
