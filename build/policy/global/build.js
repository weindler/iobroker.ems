"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildNeutralGlobalPolicy = exports.buildEffectiveGlobalPolicy = exports.buildConfiguredGlobalPolicy = void 0;
const constants_1 = require("../core/constants");
const merge_1 = require("../core/merge");
const provenance_1 = require("../core/provenance");
const value_1 = require("../core/value");
const validate_1 = require("../core/validate");
const GLOBAL_LIMIT_KINDS = {
    houseFuseLimitW: "maximum",
    maxGridImportW: "maximum",
};
function baseCapabilities() {
    return {
        flexibleOptimization: (0, value_1.unknownTriState)("default", "advisory"),
    };
}
function buildConfiguredGlobalPolicy(admin) {
    const limits = {};
    const preferences = {};
    const protection = {};
    const economics = {};
    if (admin.houseFuseLimitW !== null && Number.isFinite(admin.houseFuseLimitW)) {
        limits.houseFuseLimitW = (0, value_1.policyValue)(admin.houseFuseLimitW, "admin", "hard", {
            sourcePath: "global_policy_house_fuse_limit_w",
        });
    }
    else {
        limits.houseFuseLimitW = (0, value_1.unknownValue)("default", "advisory");
    }
    if (admin.maxGridImportW !== null && Number.isFinite(admin.maxGridImportW)) {
        limits.maxGridImportW = (0, value_1.policyValue)(admin.maxGridImportW, "admin", "hard", {
            sourcePath: "global_policy_max_grid_import_w",
        });
    }
    else {
        limits.maxGridImportW = (0, value_1.unknownValue)("default", "advisory");
    }
    if (admin.energyPriority && admin.energyPriority.length > 0) {
        preferences.energyPriority = (0, value_1.policyValue)(admin.energyPriority, "admin", "soft", {
            sourcePath: "global_policy_energy_priority_json",
        });
    }
    else {
        preferences.energyPriority = (0, value_1.unknownValue)("default", "advisory");
    }
    if (admin.mutualExclusions && admin.mutualExclusions.length > 0) {
        protection.mutualExclusions = (0, value_1.policyValue)(admin.mutualExclusions, "admin", "hard", {
            sourcePath: "global_policy_mutual_exclusions_json",
        });
    }
    else {
        protection.mutualExclusions = (0, value_1.unknownValue)("default", "advisory");
    }
    if (admin.gridImportAllowed !== null) {
        economics.gridImportAllowed = (0, value_1.policyValue)(admin.gridImportAllowed, "admin", "hard", {
            sourcePath: "global_policy_grid_import_allowed",
        });
    }
    else {
        economics.gridImportAllowed = (0, value_1.unknownValue)("default", "advisory");
    }
    const snapshot = {
        meta: {
            schemaVersion: constants_1.POLICY_SCHEMA_VERSION,
            engineVersion: constants_1.POLICY_ENGINE_VERSION,
            providerId: "policy.global",
            addonType: "system",
            instanceId: "global",
        },
        capabilities: baseCapabilities(),
        limits,
        preferences,
        protection,
        economics,
        validation: { valid: true, status: "valid", issues: [] },
        status: "ready",
    };
    snapshot.validation = (0, validate_1.validatePolicySnapshot)(snapshot);
    snapshot.provenance = (0, provenance_1.buildProvenanceMap)(snapshot);
    return snapshot;
}
exports.buildConfiguredGlobalPolicy = buildConfiguredGlobalPolicy;
function globalModeOverlay(profile) {
    const capabilities = {
        flexibleOptimization: (0, value_1.policyValue)(profile.flexibleOptimization, "global_mode", "soft", { reason: `Global Mode ${profile.mode}` }),
    };
    const preferences = {
        economyWeight: (0, value_1.policyValue)(profile.economyWeight, "global_mode", "soft"),
        comfortWeight: (0, value_1.policyValue)(profile.comfortWeight, "global_mode", "soft"),
        shiftTolerance: (0, value_1.policyValue)(profile.shiftTolerance, "global_mode", "soft"),
        userDemandPriority: (0, value_1.policyValue)(profile.userDemandPriority, "global_mode", "soft"),
    };
    const economics = {};
    const limits = {};
    if (profile.gridImportFactor < 1 && profile.gridImportFactor > 0) {
        economics.gridImportRestricted = (0, value_1.policyValue)(true, "global_mode", "soft", {
            reason: "Global Mode verschärft Netzbezug (Preference).",
        });
    }
    if (profile.mode === "off") {
        capabilities.flexibleOptimization = (0, value_1.policyValue)(false, "global_mode", "soft", {
            reason: "off: flexible Optimierung deaktiviert (keine Aktion).",
        });
    }
    return { capabilities, preferences, economics, limits };
}
function buildEffectiveGlobalPolicy(configured, profile) {
    const overlay = globalModeOverlay(profile);
    const merged = {
        ...configured,
        capabilities: (0, merge_1.mergePolicySections)(configured.capabilities, (overlay.capabilities ?? {}), "capabilities", { flexibleOptimization: "soft" }),
        limits: (0, merge_1.mergePolicySections)(configured.limits, overlay.limits ?? {}, "limits", GLOBAL_LIMIT_KINDS),
        preferences: (0, merge_1.mergePolicySections)(configured.preferences, overlay.preferences ?? {}, "preferences", {
            economyWeight: "preference",
            comfortWeight: "preference",
            shiftTolerance: "preference",
            userDemandPriority: "preference",
            energyPriority: "preference",
        }),
        protection: { ...configured.protection },
        economics: (0, merge_1.mergePolicySections)(configured.economics, overlay.economics ?? {}, "economics", { gridImportAllowed: "hard_boolean", gridImportRestricted: "soft" }),
    };
    merged.validation = (0, validate_1.validatePolicySnapshot)(merged);
    merged.status = merged.validation.valid ? "ready" : "invalid";
    merged.provenance = (0, provenance_1.buildProvenanceMap)(merged);
    return merged;
}
exports.buildEffectiveGlobalPolicy = buildEffectiveGlobalPolicy;
function buildNeutralGlobalPolicy() {
    return buildConfiguredGlobalPolicy({
        houseFuseLimitW: null,
        maxGridImportW: null,
        energyPriority: null,
        mutualExclusions: null,
        gridImportAllowed: null,
    });
}
exports.buildNeutralGlobalPolicy = buildNeutralGlobalPolicy;
