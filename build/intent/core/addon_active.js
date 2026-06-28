"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAddonIntentActive = void 0;
const governance_1 = require("../../addons/governance");
const tree_paths_1 = require("../../tree_paths");
async function isAddonIntentActive(host, addonId) {
    try {
        const enabled = await (0, governance_1.isAddonGovernanceEnabledFromState)((id) => host.getStateAsync(id), addonId);
        if (!enabled) {
            return false;
        }
        const available = await host.getStateAsync((0, tree_paths_1.addonAvailable)(addonId));
        if (available?.val === false) {
            return false;
        }
        return true;
    }
    catch {
        return false;
    }
}
exports.isAddonIntentActive = isAddonIntentActive;
