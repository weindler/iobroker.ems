"use strict";
/**
 * Unified Day Plan → bestehende DailyAllocationEntry-Form für IH/AC/Battery/Wallbox.
 * Keine Geräte-Writes — nur Plan-/Dispatch-Übersetzung.
 * Battery: nur charge (kein Discharge-Live). Wallbox: Intent für EVCC-Runtime.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildUnifiedDispatchPublish = exports.buildUnifiedIhAcDispatchPublish = exports.unifiedPlanToWallboxAllocations = exports.unifiedPlanToBatteryAllocations = exports.unifiedPlanToClimateAllocations = exports.unifiedPlanToImmersionAllocations = void 0;
const contribution_ids_1 = require("../../contribution_ids");
const addon_plan_publish_1 = require("../addon_plan_publish");
const slot_geometry_1 = require("./slot_geometry");
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
const BAT_CONTRIBUTOR = {
    type: "addon",
    id: "battery",
    addonId: "battery",
};
const WB_CONTRIBUTOR = {
    type: "addon",
    id: "wallbox",
    addonId: "wallbox",
};
function cellToEntry(cell, contributionId, contributor, opts) {
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
        mandatory: cell.constraintIds.some((id) => id.includes("mandatory") || id.includes("comfort") || id.includes("min_temp") || id.includes("energy_goal")),
        priorityRank: null,
        deadlineIso: opts?.deadlineIso ?? null,
        estimatedCostCt: opts?.estimatedCostCt ?? null,
        reasonDe: cell.reasonCodes.join(", ") || "unified_day_plan",
    };
}
/** Nur kanonische 15-Min-Zellen mit konsistenter Energy↔Power — nie Multi-Hour-Dispatch. */
function filterExecutableGeometry(entries) {
    return entries.filter((e) => {
        if ((0, slot_geometry_1.isExecutableDailyEntry)(e))
            return true;
        return false;
    });
}
/** Immersion: flexible Contribution (PV-first Soft); Pflicht separat wenn min_temp. */
function unifiedPlanToImmersionAllocations(plan) {
    const byKey = new Map();
    for (const cell of plan.allocations) {
        if (cell.kind !== "immersion_heater")
            continue;
        const mandatory = cell.constraintIds.includes("thermal.min_temp") || cell.reasonCodes.includes("thermal_mandatory");
        const id = mandatory ? contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY : contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE;
        const entry = cellToEntry(cell, id, IH_CONTRIBUTOR);
        const key = `${id}|${entry.slot.startIso}`;
        const existing = byKey.get(key);
        if (!existing) {
            byKey.set(key, entry);
            continue;
        }
        /** Hard+Soft-Zellen im selben Slot → eine Dispatch-Zeile (Leistungsstufe). */
        const eKwh = (existing.allocatedEnergyKwh ?? 0) + (entry.allocatedEnergyKwh ?? 0);
        const eW = (existing.allocatedPowerW ?? 0) + (entry.allocatedPowerW ?? 0);
        existing.allocatedEnergyKwh = Math.round(eKwh * 1000) / 1000;
        existing.allocatedPowerW = Math.round(eW * 10) / 10;
        existing.requestedEnergyKwh = existing.allocatedEnergyKwh;
        existing.requestedPowerW = existing.allocatedPowerW;
        existing.pvPowerW = (existing.pvPowerW ?? 0) + (entry.pvPowerW ?? 0);
        existing.gridPowerW = (existing.gridPowerW ?? 0) + (entry.gridPowerW ?? 0);
        existing.batteryPowerW = (existing.batteryPowerW ?? 0) + (entry.batteryPowerW ?? 0);
        if (existing.energySource !== entry.energySource)
            existing.energySource = "mixed";
        existing.mandatory = existing.mandatory || entry.mandatory;
        if (entry.reasonDe && !existing.reasonDe.includes(entry.reasonDe)) {
            existing.reasonDe = `${existing.reasonDe}; ${entry.reasonDe}`;
        }
    }
    return (0, addon_plan_publish_1.filterRunnableAllocations)(filterExecutableGeometry([...byKey.values()]), addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W);
}
exports.unifiedPlanToImmersionAllocations = unifiedPlanToImmersionAllocations;
/** Klima: air_conditioning.unit_N — Multi-Hour / Energy-Inkonsistenz nie publizieren. */
function unifiedPlanToClimateAllocations(plan) {
    const out = [];
    for (const cell of plan.allocations) {
        if (cell.kind !== "climate")
            continue;
        const m = /^air_conditioning\.unit_(\d+)$/.exec(cell.consumerId) || /^unit_(\d+)$/.exec(cell.consumerId);
        const unitIndex = m ? Number(m[1]) : Number(String(cell.consumerId).replace(/\D/g, "")) || 0;
        if (unitIndex < 1 || unitIndex > 5)
            continue;
        const entry = cellToEntry(cell, (0, contribution_ids_1.acUnitContributionId)(unitIndex), AC_CONTRIBUTOR);
        if (!(0, slot_geometry_1.isExecutableDailyEntry)(entry)) {
            entry.reasonDe = `${entry.reasonDe}; ${(0, slot_geometry_1.executableGeometryRejectReasonDe)({
                startIso: entry.slot.startIso,
                endIso: entry.slot.endIso,
                allocatedPowerW: entry.allocatedPowerW,
                allocatedEnergyKwh: entry.allocatedEnergyKwh,
            })}`;
            continue;
        }
        out.push(entry);
    }
    return (0, addon_plan_publish_1.filterRunnableAllocations)(out, addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W);
}
exports.unifiedPlanToClimateAllocations = unifiedPlanToClimateAllocations;
/**
 * Battery Charge only — Discharge-Zellen werden bewusst nicht als Live-Dispatch publiziert
 * (Sonnen EM: discharge_unverified / unsupported).
 */
function unifiedPlanToBatteryAllocations(plan) {
    const out = [];
    for (const cell of plan.allocations) {
        if (cell.kind !== "battery_charge")
            continue;
        out.push(cellToEntry(cell, contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, BAT_CONTRIBUTOR));
    }
    return (0, addon_plan_publish_1.filterRunnableAllocations)(filterExecutableGeometry(out), addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W);
}
exports.unifiedPlanToBatteryAllocations = unifiedPlanToBatteryAllocations;
/** Wallbox → wallbox.ev_session für bestehende EVCC-Runtime. */
function unifiedPlanToWallboxAllocations(plan) {
    const deadline = plan.vehicleChargeEconomics?.deadlineIso ??
        null;
    const out = [];
    for (const cell of plan.allocations) {
        if (cell.kind !== "wallbox")
            continue;
        const cost = cell.energySource === "grid" || cell.energySource === "mixed"
            ? plan.vehicleChargeEconomics?.slotCostsCtByStartIso?.[cell.slot.startIso] ?? null
            : null;
        out.push(cellToEntry(cell, contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, WB_CONTRIBUTOR, {
            deadlineIso: deadline,
            estimatedCostCt: cost,
        }));
    }
    return (0, addon_plan_publish_1.filterRunnableAllocations)(filterExecutableGeometry(out), addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W);
}
exports.unifiedPlanToWallboxAllocations = unifiedPlanToWallboxAllocations;
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
function buildUnifiedDispatchPublish(plan) {
    const ihAc = buildUnifiedIhAcDispatchPublish(plan);
    const batteryEntries = unifiedPlanToBatteryAllocations(plan);
    const wallboxEntries = unifiedPlanToWallboxAllocations(plan);
    return {
        ...ihAc,
        batteryEntries,
        wallboxEntries,
        batteryStatus: batteryEntries.length > 0 ? "ready" : "idle",
        wallboxStatus: wallboxEntries.length > 0 ? "ready" : "idle",
        batteryReasonDe: batteryEntries.length > 0
            ? `Unified Day Plan: ${batteryEntries.length} fahrbare Batterie-Lade-Fenster (charge/hold; kein Discharge-Live).`
            : "Unified Day Plan: kein fahrbares Batterie-Lade-Fenster.",
        wallboxReasonDe: wallboxEntries.length > 0
            ? `Unified Day Plan: ${wallboxEntries.length} fahrbare Wallbox-Fenster (EVCC).`
            : "Unified Day Plan: kein fahrbares Wallbox-Fenster.",
    };
}
exports.buildUnifiedDispatchPublish = buildUnifiedDispatchPublish;
