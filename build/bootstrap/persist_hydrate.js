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
    const learningHost = (0, ems_light_1.getLearningStateTreeHost)();
    if (learningHost) {
        await (0, persistence_mirror_1.restoreLearningPersistenceFromStates)(learningHost);
    }
    await (0, engine_3.hydrateIntentPersist)(intentHydrateHost(host));
    await (0, engine_2.hydrateImmersionRuntimePersist)(immersionHydrateHost(host));
    await (0, engine_1.hydrateAcRuntimePersist)(acHydrateHost(host));
    await (0, runtime_1.hydrateWallboxVehicleSocPersistence)(wallboxVehicleHydrateHost(host), host.config);
}
exports.hydratePersistedState = hydratePersistedState;
