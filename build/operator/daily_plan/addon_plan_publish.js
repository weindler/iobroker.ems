"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addonAllocationPublishView = exports.filterRunnableAllocations = exports.addonAllocationEntries = exports.RUNNABLE_ALLOCATION_FLOOR_W = void 0;
/** Unter dieser Leistung gilt ein Allocation-Eintrag als nicht fahrbar (VIS/Status). */
exports.RUNNABLE_ALLOCATION_FLOOR_W = 50;
function addonAllocationEntries(plan, addonPrefix) {
    if (addonPrefix === "air_conditioning") {
        return plan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
    }
    return plan.allocations.filter((a) => a.contributionId === addonPrefix ||
        a.contributionId.startsWith(`${addonPrefix}.`) ||
        (a.contributor.id === addonPrefix && addonPrefix !== "air_conditioning"));
}
exports.addonAllocationEntries = addonAllocationEntries;
function filterRunnableAllocations(entries, floorW = exports.RUNNABLE_ALLOCATION_FLOOR_W) {
    return entries.filter((a) => (a.allocatedPowerW ?? 0) >= floorW);
}
exports.filterRunnableAllocations = filterRunnableAllocations;
function addonAllocationPublishView(plan, addonPrefix, opts) {
    const all = addonAllocationEntries(plan, addonPrefix);
    const runnable = filterRunnableAllocations(all, opts?.floorW);
    const ki = opts?.kiWriteback ? " (ggf. KI Plan B)" : "";
    if (runnable.length > 0) {
        return {
            runnable,
            status: "ready",
            reasonDe: `${runnable.length} fahrbare Fenster für ${addonPrefix}${ki}.`,
        };
    }
    if (all.length > 0) {
        return {
            runnable,
            status: "idle",
            reasonDe: `Keine fahrbaren Fenster für ${addonPrefix} (${all.length} Mikro-Einträge verworfen)${ki}.`,
        };
    }
    return {
        runnable,
        status: "idle",
        reasonDe: `Keine Allocation für ${addonPrefix}.`,
    };
}
exports.addonAllocationPublishView = addonAllocationPublishView;
