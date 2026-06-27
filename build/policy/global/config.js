"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyGlobalPolicyAdminConfig = exports.globalPolicyConfigFromAdapter = void 0;
const state_util_1 = require("../../ems_light/state_util");
const normalize_1 = require("../core/normalize");
function numFromConfig(config, key) {
    const v = config[key];
    if (v === null || v === undefined || v === "") {
        return null;
    }
    return (0, state_util_1.asNum)(v);
}
function parseJsonArray(config, key) {
    const v = config[key];
    if (v === null || v === undefined || v === "") {
        return null;
    }
    if (Array.isArray(v)) {
        return v;
    }
    if (typeof v === "string") {
        try {
            return JSON.parse(v);
        }
        catch {
            return null;
        }
    }
    return null;
}
function globalPolicyConfigFromAdapter(config) {
    if (!config || typeof config !== "object") {
        return {
            houseFuseLimitW: null,
            maxGridImportW: null,
            energyPriority: null,
            mutualExclusions: null,
            gridImportAllowed: null,
        };
    }
    const c = config;
    const fuse = numFromConfig(c, "global_policy_house_fuse_limit_w");
    const gridMax = numFromConfig(c, "global_policy_max_grid_import_w");
    const priorityRaw = parseJsonArray(c, "global_policy_energy_priority_json");
    const mutualRaw = parseJsonArray(c, "global_policy_mutual_exclusions_json");
    let gridImportAllowed = null;
    if (typeof c.global_policy_grid_import_allowed === "boolean") {
        gridImportAllowed = c.global_policy_grid_import_allowed;
    }
    return {
        houseFuseLimitW: fuse,
        maxGridImportW: gridMax,
        energyPriority: priorityRaw ? (0, normalize_1.normalizeEnergyPriority)(priorityRaw) : null,
        mutualExclusions: mutualRaw ? (0, normalize_1.normalizeMutualExclusions)(mutualRaw) : null,
        gridImportAllowed,
    };
}
exports.globalPolicyConfigFromAdapter = globalPolicyConfigFromAdapter;
function emptyGlobalPolicyAdminConfig() {
    return globalPolicyConfigFromAdapter({});
}
exports.emptyGlobalPolicyAdminConfig = emptyGlobalPolicyAdminConfig;
