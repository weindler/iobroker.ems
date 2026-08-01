"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EXECUTION_MODE_KEYS = exports.mergeNativeForRestore = exports.exportCurrentNativeProjection = exports.countChangedConfigFields = exports.buildRestoreProjection = void 0;
const schema_1 = require("../backup/schema");
const collect_config_1 = require("../backup/collect_config");
const collect_persistence_1 = require("../backup/collect_persistence");
const learning_map_1 = require("./learning_map");
const limits_1 = require("../backup/limits");
const vehicle_map_1 = require("../addons/wallbox/vehicle_map");
function resolveVehicleMapEntriesFromArchive(archive) {
    if (Array.isArray(archive.entries)) {
        return archive.entries;
    }
    // Legacy fat `{ profiles: [...] }` → slim map rows (EVCC id/name required).
    if (!Array.isArray(archive.profiles))
        return [];
    const out = [];
    for (const row of archive.profiles) {
        const slim = (0, vehicle_map_1.slimEntryFromLegacyProfileRow)(row);
        if (slim)
            out.push((0, vehicle_map_1.vehicleMapEntryToExportRow)(slim));
    }
    return out;
}
const EXECUTION_MODE_KEYS = [
    "global_execution_mode",
    "wb_addon_mode",
    "bat_addon_mode",
    "ih_addon_mode",
    "ac_addon_mode",
];
exports.EXECUTION_MODE_KEYS = EXECUTION_MODE_KEYS;
function parseJsonBuffer(buf, label) {
    const text = buf.toString("utf8");
    (0, limits_1.assertWithinLimit)(text.length, limits_1.EXPORT_LIMITS.MAX_SINGLE_FILE_BYTES, label);
    return JSON.parse(text);
}
function stableEqual(a, b) {
    return (0, schema_1.stableJsonStringify)(a).trim() === (0, schema_1.stableJsonStringify)(b).trim();
}
/** Baut die restorefähige Native-Projektion aus validierten Backup-Dateien. */
function buildRestoreProjection(payloadMap) {
    const adapter = parseJsonBuffer(payloadMap.get("config/adapter.json"), "adapter.json");
    const mappings = parseJsonBuffer(payloadMap.get("config/mappings.json"), "mappings.json");
    const vehicleArchive = parseJsonBuffer(payloadMap.get("config/vehicle_profiles.json"), "vehicle_profiles.json");
    const policies = parseJsonBuffer(payloadMap.get("config/policies.json"), "policies.json");
    const selectedState = parseJsonBuffer(payloadMap.get("persistence/selected_state_data.json"), "selected_state_data.json");
    const warnings = [];
    const skippedClasses = ["transient", "support_only", "excluded"];
    const native = {};
    for (const [k, v] of Object.entries(adapter.allowed_native ?? {})) {
        if ((0, collect_config_1.isAllowedConfigKey)(k) && !(0, schema_1.isSecretKey)(k)) {
            native[k] = v;
        }
    }
    for (const [k, v] of Object.entries(mappings)) {
        if ((0, collect_config_1.isAllowedConfigKey)(k) && !(0, schema_1.isSecretKey)(k)) {
            if (native[k] !== undefined && !stableEqual(native[k], v)) {
                throw new Error(`conflicting projection for ${k}`);
            }
            native[k] = v;
        }
    }
    {
        const slimEntries = resolveVehicleMapEntriesFromArchive(vehicleArchive);
        const fromAdapter = native.wb_vehicle_map;
        if (fromAdapter !== undefined && !stableEqual(fromAdapter, slimEntries)) {
            throw new Error("conflicting vehicle map");
        }
        native.wb_vehicle_map = slimEntries;
        // Drop legacy fat table from restored native.
        delete native.wb_vehicle_profiles;
    }
    for (const [k, v] of Object.entries(policies)) {
        if ((0, collect_config_1.isAllowedConfigKey)(k) && !(0, schema_1.isSecretKey)(k)) {
            if (native[k] !== undefined && !stableEqual(native[k], v)) {
                throw new Error(`conflicting policy field ${k}`);
            }
            native[k] = v;
        }
    }
    for (const key of EXECUTION_MODE_KEYS) {
        native[key] = "dryrun";
    }
    const learning = {};
    for (const key of Object.keys(selectedState)) {
        if (!collect_persistence_1.SELECTED_STATE_DATA_KEYS.includes(key)) {
            throw new Error(`unknown selected_state_data key: ${key}`);
        }
        if (!(0, learning_map_1.isKnownLearningKey)(key)) {
            throw new Error(`unknown learning key: ${key}`);
        }
        learning[key] = selectedState[key];
    }
    return {
        native,
        learning,
        configuredModesAtExport: { ...adapter.configured_modes_at_export },
        warnings,
        skippedClasses,
    };
}
exports.buildRestoreProjection = buildRestoreProjection;
function countChangedConfigFields(current, projected) {
    let n = 0;
    for (const [k, v] of Object.entries(projected)) {
        if (!stableEqual(current[k], v))
            n += 1;
    }
    return n;
}
exports.countChangedConfigFields = countChangedConfigFields;
function exportCurrentNativeProjection(current) {
    const out = {};
    for (const [k, v] of Object.entries(current)) {
        if ((0, collect_config_1.isAllowedConfigKey)(k) && !(0, schema_1.isSecretKey)(k)) {
            out[k] = v;
        }
    }
    return out;
}
exports.exportCurrentNativeProjection = exportCurrentNativeProjection;
function mergeNativeForRestore(current, projection) {
    const out = { ...current };
    const restoreKeys = new Set();
    for (const k of Object.keys(projection)) {
        if ((0, collect_config_1.isAllowedConfigKey)(k))
            restoreKeys.add(k);
    }
    for (const k of restoreKeys) {
        delete out[k];
    }
    for (const [k, v] of Object.entries(projection)) {
        if ((0, collect_config_1.isAllowedConfigKey)(k) && !(0, schema_1.isSecretKey)(k)) {
            out[k] = v;
        }
    }
    for (const key of EXECUTION_MODE_KEYS) {
        out[key] = "dryrun";
    }
    return out;
}
exports.mergeNativeForRestore = mergeNativeForRestore;
