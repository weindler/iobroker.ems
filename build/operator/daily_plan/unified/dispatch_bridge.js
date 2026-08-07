"use strict";
/**
 * Unified Day Plan → bestehende DailyAllocationEntry-Form für IH + Klima.
 * Keine Geräte-Writes — nur Plan-/Dispatch-Übersetzung.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUnifiedIhAcDispatchPublish = exports.unifiedPlanToClimateAllocations = exports.unifiedPlanToImmersionAllocations = void 0;
const contribution_ids_1 = require("../../contribution_ids");
const addon_plan_publish_1 = require("../addon_plan_publish");
const IH_CONTRIBUTOR = {
    type: "addon",
    id: "immersion_heater",
    addonId: "immersion_heater",
};
const AC_CONTRIBUTOR = {
    type: "addon",
    id: "air_conditioning",
    addonId: "air_conditioning",
};
function cellToEntry(cell, contributionId, contributor) {
    const source = cell.energySource;
    const pv = source === "pv_surplus" || source === "mixed" ? cell.allocatedPowerW : 0;
    const grid = source === "grid" || source === "mixed" ? cell.allocatedPowerW : 0;
    const bat = source === "battery" || source === "mixed" ? cell.allocatedPowerW : 0;
    return {
        contributionId,
        contributor,
        slot: cell.slot,
        status: cell.allocatedPowerW > 0 ? "allocated" : "unallocated",
        energySource: source,
        requestedPowerW: cell.allocatedPowerW,
        allocatedPowerW: cell.allocatedPowerW,
        requestedEnergyKwh: cell.allocatedEnergyKwh,
        allocatedEnergyKwh: cell.allocatedEnergyKwh,
        gridPowerW: grid,
        pvPowerW: pv,
        batteryPowerW: bat,
        mandatory: cell.constraintIds.some((id) => id.includes("mandatory") || id.includes("comfort") || id.includes("min_temp")),
        priorityRank: null,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: cell.reasonCodes.join(", ") || "unified_day_plan",
    };
}
/** Immersion: flexible Contribution (PV-first Soft); Pflicht separat wenn min_temp. */
function unifiedPlanToImmersionAllocations(plan) {
    const out = [];
    for (const cell of plan.allocations) {
        if (cell.kind !== "immersion_heater")
            continue;
        const mandatory = cell.constraintIds.includes("thermal.min_temp") || cell.reasonCodes.includes("thermal_mandatory");
        const id = mandatory ? contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY : contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE;
        out.push(cellToEntry(cell, id, IH_CONTRIBUTOR));
    }
    return (0, addon_plan_publish_1.filterRunnableAllocations)(out, addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W);
}
exports.unifiedPlanToImmersionAllocations = unifiedPlanToImmersionAllocations;
/** Klima: air_conditioning.unit_N */
function unifiedPlanToClimateAllocations(plan) {
    const out = [];
    for (const cell of plan.allocations) {
        if (cell.kind !== "climate")
            continue;
        const m = /^air_conditioning\.unit_(\d+)$/.exec(cell.consumerId) || /^unit_(\d+)$/.exec(cell.consumerId);
        const unitIndex = m ? Number(m[1]) : Number(String(cell.consumerId).replace(/\D/g, "")) || 0;
        if (unitIndex < 1 || unitIndex > 5)
            continue;
        out.push(cellToEntry(cell, (0, contribution_ids_1.acUnitContributionId)(unitIndex), AC_CONTRIBUTOR));
    }
    return (0, addon_plan_publish_1.filterRunnableAllocations)(out, addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W);
}
exports.unifiedPlanToClimateAllocations = unifiedPlanToClimateAllocations;
function buildUnifiedIhAcDispatchPublish(plan) {
    const immersionEntries = unifiedPlanToImmersionAllocations(plan);
    const climateEntries = unifiedPlanToClimateAllocations(plan);
    return {
        immersionEntries,
        climateEntries,
        immersionStatus: immersionEntries.length > 0 ? "ready" : "idle",
        climateStatus: climateEntries.length > 0 ? "ready" : "idle",
        immersionReasonDe: immersionEntries.length > 0
            ? `Unified Day Plan: ${immersionEntries.length} fahrbare Heizstab-Fenster.`
            : "Unified Day Plan: kein fahrbares Heizstab-Fenster.",
        climateReasonDe: climateEntries.length > 0
            ? `Unified Day Plan: ${climateEntries.length} fahrbare Klima-Fenster.`
            : "Unified Day Plan: kein fahrbares Klima-Fenster.",
    };
}
exports.buildUnifiedIhAcDispatchPublish = buildUnifiedIhAcDispatchPublish;
