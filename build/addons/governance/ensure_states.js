"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAddonGovernanceEnabledFromState = exports.syncAddonGovernanceFromConfig = exports.ensureAddonGovernanceStates = exports.addonGovernanceAiAllowedState = exports.addonGovernanceEnabledState = exports.addonGovernanceBase = void 0;
const state_write_1 = require("../../policy/core/state_write");
const tree_paths_1 = require("../../tree_paths");
const config_1 = require("./config");
const registry_1 = require("./registry");
function addonGovernanceBase(addonId) {
    return `addons.${addonId}.governance`;
}
exports.addonGovernanceBase = addonGovernanceBase;
function addonGovernanceEnabledState(addonId) {
    return `${addonGovernanceBase(addonId)}.enabled`;
}
exports.addonGovernanceEnabledState = addonGovernanceEnabledState;
function addonGovernanceAiAllowedState(addonId) {
    return `${addonGovernanceBase(addonId)}.ai_optimization_allowed`;
}
exports.addonGovernanceAiAllowedState = addonGovernanceAiAllowedState;
async function ensureAddonGovernanceStates(host) {
    for (const entry of registry_1.GOVERNED_ADDON_REGISTRY) {
        await host.setObjectNotExistsAsync(`addons.${entry.id}`, {
            type: "channel",
            common: { name: entry.displayNameDe },
            native: {},
        });
        await host.setObjectNotExistsAsync(addonGovernanceBase(entry.id), {
            type: "channel",
            common: { name: `${entry.displayNameDe} Governance` },
            native: {},
        });
        for (const def of [
            {
                id: addonGovernanceEnabledState(entry.id),
                name: `${entry.displayNameDe}: aktiv (Governance)`,
            },
            {
                id: addonGovernanceAiAllowedState(entry.id),
                name: `${entry.displayNameDe}: KI-Optimierung erlaubt`,
            },
        ]) {
            await host.setObjectNotExistsAsync(def.id, {
                type: "state",
                common: {
                    name: def.name,
                    type: "boolean",
                    role: "switch",
                    read: true,
                    write: false,
                },
                native: {},
            });
        }
    }
}
exports.ensureAddonGovernanceStates = ensureAddonGovernanceStates;
async function syncAddonGovernanceFromConfig(host, config) {
    for (const entry of registry_1.GOVERNED_ADDON_REGISTRY) {
        const gov = (0, config_1.getAddonGovernance)(config, entry.id);
        await (0, state_write_1.setStateIfChanged)(host, addonGovernanceEnabledState(entry.id), gov.enabled);
        await (0, state_write_1.setStateIfChanged)(host, addonGovernanceAiAllowedState(entry.id), gov.aiOptimizationAllowed);
        await (0, state_write_1.setStateIfChanged)(host, (0, tree_paths_1.addonEnabled)(entry.runtimeAddonId), gov.enabled);
    }
}
exports.syncAddonGovernanceFromConfig = syncAddonGovernanceFromConfig;
async function isAddonGovernanceEnabledFromState(getState, addonOrRuntimeId) {
    const governedId = (0, config_1.resolveGovernedAddonId)(addonOrRuntimeId);
    if (governedId) {
        const st = await getState(addonGovernanceEnabledState(governedId));
        if (st?.val === false) {
            return false;
        }
        if (st?.val === true) {
            return true;
        }
    }
    const st = await getState((0, tree_paths_1.addonEnabled)(addonOrRuntimeId));
    return st?.val !== false;
}
exports.isAddonGovernanceEnabledFromState = isAddonGovernanceEnabledFromState;
