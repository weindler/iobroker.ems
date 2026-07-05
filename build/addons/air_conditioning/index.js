"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAirConditioningStateChange = exports.stopAirConditioningModule = exports.initAirConditioningModule = void 0;
const ems_activity_1 = require("../../ems_activity");
const data_dir_1 = require("../../learning/data_dir");
const mapping_sync_1 = require("../../mapping_sync");
const constants_1 = require("./constants");
const mapping_config_1 = require("./mapping_config");
const tree_paths_1 = require("../../tree_paths");
const engine_1 = require("./runtime/engine");
function runtimeHost(adapter) {
    const base = {
        config: adapter.config,
        namespace: adapter.namespace,
        log: adapter.log,
        setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
        getStateAsync: (id) => adapter.getStateAsync(id),
        getForeignStateAsync: (id) => adapter.getForeignStateAsync(id),
        setForeignStateAsync: (id, st) => adapter.setForeignStateAsync(id, st),
        setStateAsync: (id, st) => adapter.setStateAsync(id, st),
        subscribeStatesAsync: (p) => adapter.subscribeStatesAsync(p),
        subscribeForeignStatesAsync: (p) => adapter.subscribeForeignStatesAsync(p),
        unsubscribeForeignStatesAsync: (p) => adapter.unsubscribeForeignStatesAsync(p),
    };
    return (0, data_dir_1.withLearningDataPath)(adapter, base);
}
async function initAirConditioningModule(adapter) {
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, constants_1.AC_ADDON_ID, (0, mapping_config_1.acMappingCommands)());
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, constants_1.AC_ADDON_ID, mapping_config_1.acMappingFromConfig);
    await (0, engine_1.initAcRuntimeEngine)(runtimeHost(adapter));
    (0, ems_activity_1.touchEmsActivity)();
    return null;
}
exports.initAirConditioningModule = initAirConditioningModule;
function stopAirConditioningModule() {
    (0, engine_1.stopAcRuntimeEngine)();
}
exports.stopAirConditioningModule = stopAirConditioningModule;
function handleAirConditioningStateChange(adapter, stateId) {
    const ns = `${adapter.namespace}.`;
    if (stateId === `${ns}${(0, tree_paths_1.addonEnabled)(constants_1.AC_ADDON_ID)}` ||
        stateId === `${ns}${(0, tree_paths_1.addonAvailable)(constants_1.AC_ADDON_ID)}` ||
        (0, engine_1.acRuntimeWatchedForeignIds)(adapter.config).includes(stateId)) {
        void (0, engine_1.runAcRuntimeTick)(runtimeHost(adapter)).catch((e) => adapter.log.warn(`ac runtime tick: ${e}`));
    }
}
exports.handleAirConditioningStateChange = handleAirConditioningStateChange;
