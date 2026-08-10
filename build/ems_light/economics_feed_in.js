"use strict";
/**
 * Einspeisevergütung (ct/kWh): Admin-native kanonisch → Spiegel economics.config.feed_in_ct_per_kwh.
 * Planner liest weiterhin nur den State (unverändert). Keine Faktor-100-Umwandlung.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncEconomicsFeedInFromConfig = exports.migrateAndSyncEconomicsFeedInFromConfig = exports.readNativeFeedInCtPerKwh = exports.normalizeFeedInCtPerKwhConfig = exports.FEED_IN_MIGRATED_V1_STATE = exports.FEED_IN_CT_PER_KWH_STATE = exports.FEED_IN_CT_PER_KWH_NATIVE_KEY = void 0;
const state_write_1 = require("../policy/core/state_write");
const state_util_1 = require("./state_util");
exports.FEED_IN_CT_PER_KWH_NATIVE_KEY = "feed_in_ct_per_kwh";
exports.FEED_IN_CT_PER_KWH_STATE = "economics.config.feed_in_ct_per_kwh";
exports.FEED_IN_MIGRATED_V1_STATE = "economics.config.feed_in_migrated_v1";
/** Gleiche Semantik wie Unified normalizeFeedInCtPerKwh — ct/kWh, >= 0, kein €-Faktor. */
function normalizeFeedInCtPerKwhConfig(raw) {
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0)
        return null;
    return raw;
}
exports.normalizeFeedInCtPerKwhConfig = normalizeFeedInCtPerKwhConfig;
function readNativeFeedInCtPerKwh(config) {
    if (!config || typeof config !== "object")
        return null;
    const raw = config[exports.FEED_IN_CT_PER_KWH_NATIVE_KEY];
    return normalizeFeedInCtPerKwhConfig(raw);
}
exports.readNativeFeedInCtPerKwh = readNativeFeedInCtPerKwh;
async function ensureMigrationMarkerObject(host) {
    await host.setObjectNotExistsAsync(exports.FEED_IN_MIGRATED_V1_STATE, {
        type: "state",
        common: {
            name: "Economics Einspeisevergütung: Native-Migration v1",
            type: "boolean",
            role: "indicator",
            read: true,
            write: false,
            def: false,
        },
        native: {},
    });
}
/**
 * Einmalig: gültigen Altwert aus dem State in Admin-native übernehmen (falls native leer).
 * Danach immer native → State spiegeln (eine Wahrheit).
 */
async function migrateAndSyncEconomicsFeedInFromConfig(host) {
    await ensureMigrationMarkerObject(host);
    const markerSt = await host.getStateAsync(exports.FEED_IN_MIGRATED_V1_STATE);
    const alreadyMigrated = markerSt?.val === true;
    let nativeVal = readNativeFeedInCtPerKwh(host.config);
    const stateVal = normalizeFeedInCtPerKwhConfig((0, state_util_1.asNum)((await host.getStateAsync(exports.FEED_IN_CT_PER_KWH_STATE))?.val));
    let migratedFromState = false;
    if (!alreadyMigrated) {
        if (nativeVal === null && stateVal !== null) {
            if (typeof host.updateConfig === "function") {
                const base = host.config && typeof host.config === "object"
                    ? { ...host.config }
                    : {};
                base[exports.FEED_IN_CT_PER_KWH_NATIVE_KEY] = stateVal;
                await host.updateConfig(base);
                if (host.config && typeof host.config === "object") {
                    host.config[exports.FEED_IN_CT_PER_KWH_NATIVE_KEY] = stateVal;
                }
                else {
                    host.config = base;
                }
                nativeVal = stateVal;
                migratedFromState = true;
                host.log?.info?.(`economics: migrated ${exports.FEED_IN_CT_PER_KWH_STATE}=${stateVal} → native.${exports.FEED_IN_CT_PER_KWH_NATIVE_KEY}`);
            }
            else {
                /*
                 * Tests / Host ohne updateConfig: State vorerst behalten, Marker noch nicht setzen,
                 * damit ein späterer Sync mit leerem native den Altwert nicht löscht.
                 */
                host.log?.warn?.(`economics: feed_in Altwert ${stateVal} ct/kWh im State, aber updateConfig fehlt — Native nicht geschrieben`);
            }
        }
        if (nativeVal !== null || stateVal === null || migratedFromState) {
            await host.setStateAsync(exports.FEED_IN_MIGRATED_V1_STATE, { val: true, ack: true });
        }
    }
    const canonical = readNativeFeedInCtPerKwh(host.config);
    const markerNow = (await host.getStateAsync(exports.FEED_IN_MIGRATED_V1_STATE))?.val === true;
    let mirrored = false;
    if (canonical !== null) {
        mirrored = await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.FEED_IN_CT_PER_KWH_STATE, canonical);
    }
    else if (markerNow) {
        /** Native bewusst leer → State auf null (Planner-Fallback), kein Fake-0. */
        mirrored = await (0, state_write_1.setOptionalNumberIfChanged)(host, exports.FEED_IN_CT_PER_KWH_STATE, null);
    }
    /** else: Legacy-State unangetastet bis Migration möglich */
    return { canonicalCtPerKwh: canonical, migratedFromState, mirrored };
}
exports.migrateAndSyncEconomicsFeedInFromConfig = migrateAndSyncEconomicsFeedInFromConfig;
/** Nur Spiegelung native → State (z. B. EMS-Light-Tick nach Admin-Save/Restart). */
async function syncEconomicsFeedInFromConfig(host) {
    const r = await migrateAndSyncEconomicsFeedInFromConfig(host);
    return r.mirrored;
}
exports.syncEconomicsFeedInFromConfig = syncEconomicsFeedInFromConfig;
