"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleImmersionHeaterStateChange = exports.stopImmersionHeaterModule = exports.initImmersionHeaterModule = exports.refreshImmersionHeaterRuntime = exports.startImmersionHeaterModuleRuntime = exports.ensureImmersionHeaterStateTree = exports.IMMERSION_ADDON_ID = void 0;
const ems_activity_1 = require("../../ems_activity");
const ems_mirror_alive_1 = require("../../ems_mirror_alive");
const data_dir_1 = require("../../learning/data_dir");
const mapping_sync_1 = require("../../mapping_sync");
const mapping_config_1 = require("./mapping_config");
const status_1 = require("./status");
const ensure_states_1 = require("./runtime/ensure_states");
const engine_1 = require("./runtime/engine");
const device_config_1 = require("./device_config");
const types_1 = require("./runtime/types");
exports.IMMERSION_ADDON_ID = "immersion_heater";
function runtimeHost(adapter) {
    const base = {
        config: adapter.config,
        namespace: adapter.namespace,
        log: adapter.log,
        setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
        getStateAsync: (id) => adapter.getStateAsync(id),
        getForeignStateAsync: (id) => adapter.getForeignStateAsync(id),
        setStateAsync: (id, st) => adapter.setStateAsync(id, st),
        setForeignStateAsync: (id, st) => adapter.setForeignStateAsync(id, st),
        subscribeStatesAsync: (p) => adapter.subscribeStatesAsync(p),
        subscribeForeignStatesAsync: (p) => adapter.subscribeForeignStatesAsync(p),
        unsubscribeStatesAsync: (p) => adapter.unsubscribeStatesAsync(p),
        unsubscribeForeignStatesAsync: (p) => adapter.unsubscribeForeignStatesAsync(p),
    };
    return (0, data_dir_1.withLearningDataPath)(adapter, base);
}
async function ensureImmersionHeaterStateTree(adapter) {
    await (0, ems_mirror_alive_1.ensureEmsMirrorAliveState)(adapter);
    const cfg = adapter.config && typeof adapter.config === "object"
        ? adapter.config
        : {};
    await (0, mapping_sync_1.ensureAddonMappingStates)(adapter, exports.IMMERSION_ADDON_ID, (0, mapping_sync_1.mappingCommandsFromEntries)((0, mapping_config_1.immersionHeaterMappingFromConfig)(cfg)));
    await (0, status_1.ensureImmersionStatusStates)(adapter);
    await (0, ensure_states_1.ensureImmersionRuntimeStates)(runtimeHost(adapter));
}
exports.ensureImmersionHeaterStateTree = ensureImmersionHeaterStateTree;
async function startImmersionHeaterModuleRuntime(adapter) {
    await (0, mapping_sync_1.syncNativeMappingToStates)(adapter, exports.IMMERSION_ADDON_ID, mapping_config_1.immersionHeaterMappingFromConfig);
    await (0, engine_1.initImmersionRuntimeEngine)(runtimeHost(adapter));
    (0, ems_activity_1.touchEmsActivity)();
    adapter.log.debug("immersion_heater: runtime engine + mapping (failsafe via central runner)");
    return null;
}
exports.startImmersionHeaterModuleRuntime = startImmersionHeaterModuleRuntime;
/** Post-Bootstrap-Reconciliation — aktuelle Fremdeingänge erneut einlesen. */
async function refreshImmersionHeaterRuntime(adapter) {
    await (0, engine_1.runImmersionRuntimeTick)(runtimeHost(adapter));
}
exports.refreshImmersionHeaterRuntime = refreshImmersionHeaterRuntime;
async function initImmersionHeaterModule(adapter) {
    await ensureImmersionHeaterStateTree(adapter);
    return startImmersionHeaterModuleRuntime(adapter);
}
exports.initImmersionHeaterModule = initImmersionHeaterModule;
function stopImmersionHeaterModule() {
    (0, engine_1.stopImmersionRuntimeEngine)();
}
exports.stopImmersionHeaterModule = stopImmersionHeaterModule;
function handleImmersionHeaterStateChange(adapter, stateId) {
    const ns = `${adapter.namespace}.`;
    if ((0, ems_activity_1.isEmsActivityStateId)(stateId, ns)) {
        (0, ems_activity_1.touchEmsActivity)();
    }
    const host = runtimeHost(adapter);
    if (stateId === `${ns}${types_1.IMMERSION_RUNTIME_STATES.faultReset}`) {
        void adapter.getStateAsync(types_1.IMMERSION_RUNTIME_STATES.faultReset).then((st) => {
            void (0, engine_1.handleImmersionFaultReset)(host, st);
        });
        return;
    }
    if (stateId === `${ns}user_intent.thermal.resolved_json` ||
        stateId.endsWith(".user_intent.thermal.resolved_json")) {
        void (0, engine_1.runImmersionRuntimeTick)(host).catch((e) => adapter.log.warn(`immersion runtime tick: ${e}`));
        return;
    }
    const config = (0, device_config_1.immersionDeviceConfigFromAdapter)(adapter.config);
    if ((0, engine_1.immersionRuntimeWatchedForeignIds)(config).includes(stateId)) {
        void (0, engine_1.runImmersionRuntimeTick)(host).catch((e) => adapter.log.warn(`immersion runtime tick: ${e}`));
    }
}
exports.handleImmersionHeaterStateChange = handleImmersionHeaterStateChange;
