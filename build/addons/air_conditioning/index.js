"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleAirConditioningStateChange = exports.stopAirConditioningModule = exports.initAirConditioningModule = exports.refreshAirConditioningRuntime = exports.startAirConditioningModuleRuntime = exports.ensureAirConditioningStateTree = void 0;
const ems_activity_1 = require("../../ems_activity");
const data_dir_1 = require("../../learning/data_dir");
const constants_1 = require("./constants");
const tree_paths_1 = require("../../tree_paths");
const states_1 = require("../../operator/daily_plan/states");
const ensure_states_1 = require("./runtime/ensure_states");
const engine_1 = require("./runtime/engine");
function runtimeHost(adapter) {
    const base = {
        config: adapter.config,
        namespace: adapter.namespace,
        log: adapter.log,
        updateConfig: typeof adapter
            .updateConfig === "function"
            ? (next) => adapter.updateConfig(next)
            : undefined,
        setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
        extendObjectAsync: (id, obj) => adapter.extendObjectAsync(id, obj),
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
async function ensureAirConditioningStateTree(adapter) {
    await (0, ensure_states_1.ensureAcRuntimeStates)(runtimeHost(adapter));
}
exports.ensureAirConditioningStateTree = ensureAirConditioningStateTree;
async function startAirConditioningModuleRuntime(adapter) {
    await (0, engine_1.initAcRuntimeEngine)(runtimeHost(adapter));
    (0, ems_activity_1.touchEmsActivity)();
    return null;
}
exports.startAirConditioningModuleRuntime = startAirConditioningModuleRuntime;
/** Post-Bootstrap-Reconciliation — aktuelle Fremdeingänge erneut einlesen. */
async function refreshAirConditioningRuntime(adapter) {
    await (0, engine_1.runAcRuntimeTick)(runtimeHost(adapter));
}
exports.refreshAirConditioningRuntime = refreshAirConditioningRuntime;
async function initAirConditioningModule(adapter) {
    await ensureAirConditioningStateTree(adapter);
    return startAirConditioningModuleRuntime(adapter);
}
exports.initAirConditioningModule = initAirConditioningModule;
function stopAirConditioningModule() {
    (0, engine_1.stopAcRuntimeEngine)();
}
exports.stopAirConditioningModule = stopAirConditioningModule;
function handleAirConditioningStateChange(adapter, stateId) {
    const ns = `${adapter.namespace}.`;
    const planWake = stateId === `${ns}${states_1.DAILY_PLAN_STATE_IDS.revision}` ||
        stateId === `${ns}${states_1.DAILY_PLAN_STATE_IDS.status}` ||
        stateId === `${ns}${states_1.DAILY_PLAN_STATE_IDS.planJson}` ||
        stateId === `${ns}${states_1.ALLOCATION_ADDON_STATE_IDS.air_conditioning.status}` ||
        stateId === `${ns}${states_1.ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson}`;
    if (stateId === `${ns}${(0, tree_paths_1.addonEnabled)(constants_1.AC_ADDON_ID)}` ||
        stateId === `${ns}${(0, tree_paths_1.addonAvailable)(constants_1.AC_ADDON_ID)}` ||
        planWake ||
        (0, engine_1.acRuntimeWatchedForeignIds)(adapter.config).includes(stateId)) {
        void (0, engine_1.runAcRuntimeTick)(runtimeHost(adapter)).catch((e) => adapter.log.warn(`ac runtime tick: ${e}`));
    }
}
exports.handleAirConditioningStateChange = handleAirConditioningStateChange;
