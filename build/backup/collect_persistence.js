"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isTransientStateId = exports.collectVehicleSupportPersistence = exports.collectRestorableFileArtifacts = exports.assertBackupRestoreExclusion = exports.assertSelectedStateDataShape = exports.collectSelectedStateData = exports.collectLearningPersistence = exports.SELECTED_STATE_DATA_KEYS = exports.SELECTED_STATE_DATA_ARTIFACTS = void 0;
const fs = __importStar(require("node:fs/promises"));
const path = __importStar(require("node:path"));
const data_dir_1 = require("../learning/data_dir");
const limits_1 = require("./limits");
const LEARNING_MIRROR_KEYS = [
    "battery_runtime_json",
    "house_load_json",
    "thermal_runtime_json",
    "price_learning_json",
    "price_forecast_json",
    "pv_bias_daily_json",
    "power_hourly_json",
    "energy_daily_json",
];
/** Exakt erlaubte Top-Level-Keys in persistence/selected_state_data.json (nur Learning-Dateien). */
exports.SELECTED_STATE_DATA_ARTIFACTS = [
    { category: "learning/battery_runtime", fileName: "battery_runtime_learning_v1.json" },
    { category: "learning/house_load", fileName: "house_load_learning_v1.json" },
    { category: "learning/thermal_runtime", fileName: "thermal_runtime_learning_v1.json" },
    { category: "learning/price_learning", fileName: "price_learning_v1.json" },
    { category: "learning/price_forecast", fileName: "price_forecast_learning_v1.json" },
    { category: "learning/pv_bias", fileName: "pv_bias_daily_v1.json" },
    { category: "learning/power_rollup", fileName: "power_hourly_v1.json" },
    { category: "learning/energy_daily_rollup", fileName: "energy_daily_v1.json" },
    { category: "learning/consumer_stats", fileName: "consumer_stats_v1.json" },
    { category: "learning/day_evaluation", fileName: "day_evaluation_v1.json" },
    { category: "learning/vehicle_presence", fileName: "vehicle_presence_learning_v1.json" },
];
exports.SELECTED_STATE_DATA_KEYS = exports.SELECTED_STATE_DATA_ARTIFACTS.map((a) => a.fileName);
const LEARNING_FILE_ARTIFACTS = exports.SELECTED_STATE_DATA_ARTIFACTS;
async function readJsonFileSafe(filePath, maxBytes) {
    try {
        const st = await fs.stat(filePath);
        if (st.size > maxBytes) {
            throw new Error(`persist file too large: ${filePath}`);
        }
        const raw = await fs.readFile(filePath, "utf8");
        return JSON.parse(raw);
    }
    catch (e) {
        if (e instanceof Error && e.message.includes("too large"))
            throw e;
        return null;
    }
}
async function collectLearningPersistence(host) {
    const out = {
        mirror_states: {},
        files: {},
    };
    for (const key of LEARNING_MIRROR_KEYS) {
        const rel = `learning.persistence.${key}`;
        const st = await host.getStateAsync(rel);
        if (st?.val != null && String(st.val).trim() !== "") {
            try {
                out.mirror_states[key] = JSON.parse(String(st.val));
            }
            catch {
                // defensiv ignorieren
            }
        }
    }
    const adapter = host;
    for (const art of LEARNING_FILE_ARTIFACTS) {
        const base = (0, data_dir_1.learningDataPath)(adapter, art.category);
        const parsed = await readJsonFileSafe(path.join(base, art.fileName), limits_1.EXPORT_LIMITS.MAX_PERSIST_FILE_READ_BYTES);
        if (parsed != null) {
            out.files[art.fileName] = parsed;
        }
    }
    return out;
}
exports.collectLearningPersistence = collectLearningPersistence;
/** Nur langfristige Learning-Persistenz für persistence/selected_state_data.json. */
async function collectSelectedStateData(host) {
    const adapter = host;
    const out = {};
    for (const art of exports.SELECTED_STATE_DATA_ARTIFACTS) {
        const base = (0, data_dir_1.learningDataPath)(adapter, art.category);
        const parsed = await readJsonFileSafe(path.join(base, art.fileName), limits_1.EXPORT_LIMITS.MAX_PERSIST_FILE_READ_BYTES);
        if (parsed != null) {
            out[art.fileName] = parsed;
        }
    }
    return out;
}
exports.collectSelectedStateData = collectSelectedStateData;
function assertSelectedStateDataShape(data) {
    for (const key of Object.keys(data)) {
        if (!exports.SELECTED_STATE_DATA_KEYS.includes(key)) {
            throw new Error(`forbidden selected_state_data key: ${key}`);
        }
    }
}
exports.assertSelectedStateDataShape = assertSelectedStateDataShape;
const FORBIDDEN_RESTORE_SUBSTRINGS = [
    "intent_v1.json",
    "global_modes_v1.json",
    "command.inbox",
    "issued_at",
    "expires_at",
    "pending_feedback",
    "active_ownership",
    "planner.dispatch",
    "daily_plan.dispatch",
];
/** Prüft restorefähige Backup-Dateien auf ausgeschlossene Laufzeitinhalte. */
function assertBackupRestoreExclusion(entries) {
    const restorePaths = entries.filter((e) => e.path.startsWith("config/") || e.path.startsWith("persistence/"));
    for (const e of restorePaths) {
        if (e.path === "config/adapter.json") {
            const parsed = JSON.parse(e.content);
            if (!parsed.restore_policy || parsed.restore_policy.apply_as !== "dryrun") {
                throw new Error("adapter.json missing dryrun restore_policy");
            }
            continue;
        }
        const lower = e.content.toLowerCase();
        for (const forbidden of FORBIDDEN_RESTORE_SUBSTRINGS) {
            if (lower.includes(forbidden.toLowerCase())) {
                throw new Error(`forbidden runtime content in ${e.path}: ${forbidden}`);
            }
        }
        if (e.path === "persistence/selected_state_data.json") {
            assertSelectedStateDataShape(JSON.parse(e.content));
        }
    }
}
exports.assertBackupRestoreExclusion = assertBackupRestoreExclusion;
async function collectRestorableFileArtifacts(_host) {
    // v0.1.141: Intent/Global-Modes/Policy-Dateien sind keine restorefähigen Backup-Inhalte.
    return {};
}
exports.collectRestorableFileArtifacts = collectRestorableFileArtifacts;
/** Support-only: Vehicle-Persistenz aus estimation-States (kein Restore-Bereich). */
async function collectVehicleSupportPersistence(host) {
    const out = {};
    if (!host.getObjectAsync)
        return out;
    // Nur bekannte estimation-Persistenzfelder — kein vollständiger Profil-Dump
    const suffixes = [
        "estimation.baseline_soc_pct",
        "estimation.baseline_soc_source",
        "estimation.baseline_at",
        "estimation.baseline_session_energy_kwh",
        "estimation.last_trusted_soc_pct",
        "estimation.last_trusted_original_source",
        "estimation.last_trusted_observed_at",
    ];
    for await (const obj of walkObjects(host, "addons.wallbox.vehicles.")) {
        const rel = obj._id.startsWith(`${host.namespace}.`) ? obj._id.slice(host.namespace.length + 1) : obj._id;
        const parts = rel.split(".");
        if (parts.length < 4)
            continue;
        const vehicleId = parts[3];
        if (!vehicleId)
            continue;
        if (!out[vehicleId])
            out[vehicleId] = {};
        for (const suffix of suffixes) {
            const stateId = `addons.wallbox.vehicles.${vehicleId}.${suffix}`;
            const st = await host.getStateAsync(stateId);
            if (st?.val !== undefined && st.val !== null && st.val !== "") {
                out[vehicleId][suffix] = st.val;
            }
        }
    }
    return out;
}
exports.collectVehicleSupportPersistence = collectVehicleSupportPersistence;
async function* walkObjects(host, prefix) {
    // Fat vehicle trees removed in v0.1.227 — nothing to enumerate from config.
    void host;
    void prefix;
}
function isTransientStateId(relativeId) {
    if (relativeId.startsWith("command."))
        return true;
    if (relativeId.includes(".telemetry."))
        return true;
    if (relativeId.includes(".dryrun."))
        return true;
    if (relativeId.endsWith(".connected") || relativeId.endsWith(".charging"))
        return true;
    if (relativeId.includes("user_intent.") && relativeId.includes("resolved"))
        return true;
    if (relativeId.startsWith("planner.") && relativeId.includes("dispatch"))
        return true;
    return false;
}
exports.isTransientStateId = isTransientStateId;
