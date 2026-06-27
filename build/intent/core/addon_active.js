"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAddonIntentActive = void 0;
const tree_paths_1 = require("../../tree_paths");
async function isAddonIntentActive(host, addonId) {
    try {
        const enabled = await host.getStateAsync((0, tree_paths_1.addonEnabled)(addonId));
        const available = await host.getStateAsync((0, tree_paths_1.addonAvailable)(addonId));
        if (enabled?.val === false) {
            return false;
        }
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
