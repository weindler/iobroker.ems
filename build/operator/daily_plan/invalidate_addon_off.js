"use strict";
/**
 * Befund 005: Beim Wechsel auf Add-on mode=off sofort aktive Plan-Darstellung
 * invalidieren — kein Warten auf den nächsten Daily-Plan-Tick.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isAddonContributionId = isAddonContributionId;
exports.unifiedKindsForAddon = unifiedKindsForAddon;
exports.stripAddonFromUnifiedPlan = stripAddonFromUnifiedPlan;
exports.stripAddonFromDailyPlan = stripAddonFromDailyPlan;
const authority_1 = require("./unified/authority");
function isAddonContributionId(addonId, contributionId) {
    switch (addonId) {
        case "immersion_heater":
            return contributionId.startsWith("immersion_heater.");
        case "air_conditioning":
            return contributionId.startsWith("air_conditioning.");
        case "battery":
            return (0, authority_1.isBatteryContributionId)(contributionId);
        case "wallbox":
            return (0, authority_1.isWallboxContributionId)(contributionId);
        default:
            return false;
    }
}
function unifiedKindsForAddon(addonId) {
    switch (addonId) {
        case "immersion_heater":
            return new Set(["immersion_heater"]);
        case "air_conditioning":
            return new Set(["climate"]);
        case "battery":
            return new Set(["battery_charge", "battery_discharge"]);
        case "wallbox":
            return new Set(["wallbox"]);
        default:
            return new Set();
    }
}
/** Entfernt aktive EMS-Fenster des Add-ons aus dem Unified-Plan (in-memory). */
function stripAddonFromUnifiedPlan(plan, addonId) {
    const kinds = unifiedKindsForAddon(addonId);
    const allocations = plan.allocations.filter((a) => !kinds.has(a.kind));
    return { ...plan, allocations };
}
/** Entfernt Addon-Slices aus dem publizierten Daily Plan. */
function stripAddonFromDailyPlan(plan, addonId) {
    const keep = (a) => !isAddonContributionId(addonId, a.contributionId);
    const allocations = plan.allocations.filter(keep);
    const slots = plan.slots.map((slot) => ({
        ...slot,
        allocations: slot.allocations.filter(keep),
    }));
    return { ...plan, allocations, slots };
}
