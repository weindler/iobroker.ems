"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.stopMeasuredConsumersModule = exports.refreshMeasuredConsumersRuntime = exports.startMeasuredConsumersModuleRuntime = exports.ensureMeasuredConsumersStateTree = exports.MEASURED_CONSUMERS_ADDON_ID = void 0;
const data_dir_1 = require("../../learning/data_dir");
const engine_1 = require("./runtime/engine");
const config_1 = require("./config");
const ensure_states_1 = require("./runtime/ensure_states");
exports.MEASURED_CONSUMERS_ADDON_ID = "measured_consumers";
function runtimeHost(adapter) {
    const base = {
        config: adapter.config,
        log: adapter.log,
        setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
        extendObjectAsync: (id, obj) => adapter.extendObjectAsync(id, obj),
        getStateAsync: (id) => adapter.getStateAsync(id),
        getForeignStateAsync: (id) => adapter.getForeignStateAsync(id),
        getForeignObjectAsync: (id) => adapter.getForeignObjectAsync(id),
        getObjectAsync: (id) => adapter.getObjectAsync(id),
        setStateAsync: (id, st) => adapter.setStateAsync(id, st),
    };
    return (0, data_dir_1.withLearningDataPath)(adapter, base);
}
/** Phase B — statischer State-Tree; nur Zeilen aus der Admin-Tabelle (kein 20-facher Leerlauf). */
async function ensureMeasuredConsumersStateTree(adapter) {
    const slots = (0, config_1.configuredMeasuredConsumerSlots)(adapter.config);
    await (0, ensure_states_1.ensureMeasuredConsumersStates)(runtimeHost(adapter), slots);
}
exports.ensureMeasuredConsumersStateTree = ensureMeasuredConsumersStateTree;
/** Phase E — periodischer Tick (rein lesend, keine Geräte-Writes). */
async function startMeasuredConsumersModuleRuntime(adapter) {
    await (0, engine_1.initMeasuredConsumersRuntimeEngine)(runtimeHost(adapter));
    adapter.log.debug("measured_consumers: runtime engine (rein messend, kein Schalten)");
    return null;
}
exports.startMeasuredConsumersModuleRuntime = startMeasuredConsumersModuleRuntime;
/** Post-Bootstrap-Reconciliation — aktuelle Fremdeingänge einmalig neu einlesen. */
async function refreshMeasuredConsumersRuntime(adapter) {
    await (0, engine_1.runMeasuredConsumersTick)(runtimeHost(adapter));
}
exports.refreshMeasuredConsumersRuntime = refreshMeasuredConsumersRuntime;
function stopMeasuredConsumersModule() {
    (0, engine_1.stopMeasuredConsumersRuntimeEngine)();
}
exports.stopMeasuredConsumersModule = stopMeasuredConsumersModule;
