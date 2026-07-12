"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hydratePersistedState = void 0;
const engine_1 = require("../addons/air_conditioning/runtime/engine");
const engine_2 = require("../addons/immersion_heater/runtime/engine");
const runtime_1 = require("../addons/wallbox/vehicles/runtime");
const engine_3 = require("../intent/engine");
const persistence_mirror_1 = require("../learning/persistence_mirror");
const data_dir_1 = require("../learning/data_dir");
const ems_light_1 = require("../ems_light");
const init_guard_1 = require("../diagnostics/init_guard");
const startup_memory_1 = require("../diagnostics/startup_memory");
const memory_inventory_1 = require("../diagnostics/memory_inventory");
function intentHydrateHost(adapter) {
    return {
        config: adapter.config,
        log: adapter.log,
        getAbsolutePath: (category) => (0, data_dir_1.learningDataPath)(adapter, category),
        setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
        getStateAsync: adapter.getStateAsync.bind(adapter),
        setStateAsync: adapter.setStateAsync.bind(adapter),
        getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
    };
}
function immersionHydrateHost(adapter) {
    return {
        config: adapter.config,
        log: adapter.log,
        getAbsolutePath: (category) => (0, data_dir_1.learningDataPath)(adapter, category),
        setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
        getStateAsync: adapter.getStateAsync.bind(adapter),
        setStateAsync: adapter.setStateAsync.bind(adapter),
        getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
        setForeignStateAsync: adapter.setForeignStateAsync.bind(adapter),
    };
}
function acHydrateHost(adapter) {
    return {
        config: adapter.config,
        namespace: adapter.namespace,
        log: adapter.log,
        getAbsolutePath: (category) => (0, data_dir_1.learningDataPath)(adapter, category),
        setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
        getStateAsync: adapter.getStateAsync.bind(adapter),
        setStateAsync: adapter.setStateAsync.bind(adapter),
        getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
        setForeignStateAsync: adapter.setForeignStateAsync.bind(adapter),
    };
}
function wallboxVehicleHydrateHost(adapter) {
    return adapter;
}
/**
 * Phase D — Persistenz aus Dateien/Spiegelstates laden.
 * Läuft nach Ensure (B/C) und vor Sync, Subscriptions und Runtime-Auswertung.
 */
async function hydratePersistedState(host) {
    (0, startup_memory_1.probeStartupMemory)(host.log, "before_persist_hydration");
    (0, init_guard_1.markModuleInit)("persist_hydration");
    (0, init_guard_1.markModuleInit)("persist_hydration");
    const learningHost = (0, ems_light_1.getLearningStateTreeHost)();
    if (learningHost) {
        (0, startup_memory_1.probeStartupMemory)(host.log, "before_learning_persist_mirror");
        await (0, persistence_mirror_1.restoreLearningPersistenceFromStates)(learningHost);
        (0, memory_inventory_1.logMemoryInventory)(host.log, "learning_persist_mirror", "after_restore");
        (0, startup_memory_1.probeStartupMemory)(host.log, "after_learning_persist_mirror");
    }
    (0, startup_memory_1.probeStartupMemory)(host.log, "before_intent_hydration");
    await (0, engine_3.hydrateIntentPersist)(intentHydrateHost(host));
    (0, startup_memory_1.probeStartupMemory)(host.log, "after_intent_hydration");
    (0, startup_memory_1.probeStartupMemory)(host.log, "before_immersion_hydration");
    await (0, engine_2.hydrateImmersionRuntimePersist)(immersionHydrateHost(host));
    (0, startup_memory_1.probeStartupMemory)(host.log, "after_immersion_hydration");
    (0, startup_memory_1.probeStartupMemory)(host.log, "before_ac_hydration");
    await (0, engine_1.hydrateAcRuntimePersist)(acHydrateHost(host));
    (0, startup_memory_1.probeStartupMemory)(host.log, "after_ac_hydration");
    await (0, runtime_1.hydrateWallboxVehicleSocPersistence)(wallboxVehicleHydrateHost(host), host.config);
    (0, startup_memory_1.probeStartupMemory)(host.log, "after_persist_hydration");
}
exports.hydratePersistedState = hydratePersistedState;
