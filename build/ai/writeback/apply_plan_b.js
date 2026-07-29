"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyAiPreferencesToDailyPlan = void 0;
const registry_1 = require("../../addons/governance/registry");
const slots_1 = require("../../operator/daily_plan/slots");
const build_1 = require("../compare/build");
const redistribute_1 = require("../compare/redistribute");
const device_config_1 = require("../../addons/immersion_heater/device_config");
const addon_plan_publish_1 = require("../../operator/daily_plan/addon_plan_publish");
function inferMinPowerW(ownWPerSlot, runtimeAddonId) {
    const runnable = ownWPerSlot.filter((w) => w >= addon_plan_publish_1.RUNNABLE_ALLOCATION_FLOOR_W);
    if (runnable.length > 0)
        return Math.min(...runnable);
    return runtimeAddonId === "immersion_heater" ? device_config_1.SINGLE_STAGE_DEFAULT_NOMINAL_W : 500;
}
function clonePlan(plan) {
    return JSON.parse(JSON.stringify(plan));
}
function flexEntries(slot, prefix) {
    return slot.allocations.filter((a) => !a.mandatory && a.contributionId.startsWith(prefix));
}
function sumFlexW(slot, prefix) {
    return flexEntries(slot, prefix).reduce((s, a) => s + (a.allocatedPowerW ?? 0), 0);
}
function ensureFlexEntry(slot, prefix, template) {
    const existing = flexEntries(slot, prefix);
    if (existing.length > 0)
        return existing[0];
    if (!template)
        return null;
    const created = {
        ...JSON.parse(JSON.stringify(template)),
        slot: { startIso: slot.slot.startIso, endIso: slot.slot.endIso },
        allocatedPowerW: 0,
        pvPowerW: 0,
        gridPowerW: 0,
        allocatedEnergyKwh: 0,
        estimatedCostCt: null,
        mandatory: false,
        reasonDe: "KI Write-back (Plan B)",
    };
    slot.allocations.push(created);
    return created;
}
function applyNewPowerToFlex(slot, prefix, newW, slotMinutes, template) {
    let entries = flexEntries(slot, prefix);
    if (entries.length === 0 && newW > 0) {
        const created = ensureFlexEntry(slot, prefix, template);
        if (!created)
            return;
        entries = [created];
    }
    const oldW = entries.reduce((s, a) => s + (a.allocatedPowerW ?? 0), 0);
    if (entries.length === 0)
        return;
    if (oldW <= 0) {
        const a = entries[0];
        const pvShare = Math.min(newW, Math.max(0, slot.availablePvSurplusPowerW ?? 0));
        a.allocatedPowerW = newW;
        a.pvPowerW = pvShare;
        a.gridPowerW = Math.max(0, newW - pvShare);
        a.allocatedEnergyKwh = (0, slots_1.energyKwhFromPower)(newW, slotMinutes);
        a.estimatedCostCt =
            slot.gridPriceCtPerKwh !== null
                ? Math.round(a.gridPowerW * (slotMinutes / 60) * slot.gridPriceCtPerKwh) / 1000
                : null;
        a.energySource = a.gridPowerW > 0 && a.pvPowerW > 0 ? "mixed" : a.gridPowerW > 0 ? "grid" : "pv_surplus";
        a.reasonDe = "KI Write-back (Plan B)";
        return;
    }
    const scale = newW / oldW;
    for (const a of entries) {
        const before = a.allocatedPowerW ?? 0;
        const next = before * scale;
        const pvScale = before > 0 ? (a.pvPowerW ?? 0) / before : 0;
        a.allocatedPowerW = next;
        a.pvPowerW = next * pvScale;
        a.gridPowerW = Math.max(0, next - a.pvPowerW);
        a.allocatedEnergyKwh = (0, slots_1.energyKwhFromPower)(next, slotMinutes);
        a.estimatedCostCt =
            slot.gridPriceCtPerKwh !== null
                ? Math.round(a.gridPowerW * (slotMinutes / 60) * slot.gridPriceCtPerKwh) / 1000
                : a.estimatedCostCt;
        a.reasonDe = "KI Write-back (Plan B)";
    }
}
function recomputeSlotAggregates(slot) {
    let flex = 0;
    let pv = 0;
    let grid = 0;
    let bat = 0;
    for (const a of slot.allocations) {
        flex += a.allocatedPowerW ?? 0;
        pv += a.pvPowerW ?? 0;
        grid += a.gridPowerW ?? 0;
        bat += a.batteryPowerW ?? 0;
    }
    slot.allocatedFlexiblePowerW = flex;
    slot.allocatedPvPowerW = pv;
    slot.allocatedGridPowerW = grid;
    slot.allocatedBatteryPowerW = bat;
    const availPv = slot.availablePvSurplusPowerW;
    slot.remainingPvSurplusPowerW = availPv !== null ? Math.max(0, availPv - pv) : null;
    const remGrid = slot.remainingGridImportPowerW;
    slot.remainingGridImportPowerWAfterAlloc = remGrid !== null ? Math.max(0, remGrid - grid) : null;
}
function redistributeEligible(plan, governedId, slotPreferences) {
    const prefix = (0, build_1.contributionPrefixForCompare)(governedId);
    const runtimeId = (0, registry_1.governedAddonEntry)(governedId).runtimeAddonId;
    const ownWPerSlot = [];
    const capacityPerSlot = [];
    const multipliers = [];
    const weightByIso = new Map(slotPreferences.filter((p) => p.addonId === governedId).map((p) => [p.slotStartIso, p.weight]));
    let deadlineMs = null;
    if (governedId === "wallbox") {
        for (const slot of plan.slots) {
            for (const a of flexEntries(slot, prefix)) {
                if (!a.deadlineIso)
                    continue;
                const t = Date.parse(a.deadlineIso);
                if (!Number.isFinite(t))
                    continue;
                deadlineMs = deadlineMs === null ? t : Math.min(deadlineMs, t);
            }
        }
    }
    for (const slot of plan.slots) {
        const ownW = sumFlexW(slot, prefix);
        const remainingPv = Math.max(0, slot.remainingPvSurplusPowerW ?? 0);
        const remainingGrid = slot.gridImportAllowed ? Math.max(0, slot.remainingGridImportPowerWAfterAlloc ?? 0) : 0;
        ownWPerSlot.push(ownW);
        let capacityW = Math.max(ownW, ownW + remainingPv + remainingGrid);
        if (deadlineMs !== null) {
            const slotStartMs = Date.parse(slot.slot.startIso);
            if (Number.isFinite(slotStartMs) && slotStartMs >= deadlineMs) {
                capacityW = ownW;
            }
        }
        capacityPerSlot.push(capacityW);
        multipliers.push(weightByIso.get(slot.slot.startIso) ?? 1);
    }
    return (0, redistribute_1.redistributeAddonAcrossSlots)(ownWPerSlot.map((ownW, i) => ({ ownW, capacityW: capacityPerSlot[i] })), multipliers, inferMinPowerW(ownWPerSlot, runtimeId));
}
/**
 * Wendet KI-Slot-Präferenzen auf eine Kopie von Plan A an, wenn Plan B messbar gewinnt.
 * Pflicht-Allocationen bleiben unverändert; nur flexible IH/Klima/Batterie-Laden/Wallbox werden verschoben.
 */
function applyAiPreferencesToDailyPlan(plan, allowedAddonIds, slotPreferences) {
    const compare = (0, build_1.buildCompareResult)(plan, allowedAddonIds, slotPreferences);
    const beats = (0, build_1.planBBeatsPlanA)({
        deltaCostCt: compare.delta.deltaCostCt,
        deltaGridKwh: compare.delta.planB.gridKwh - compare.delta.planA.gridKwh,
        deltaPvKwh: compare.delta.planB.pvKwh - compare.delta.planA.pvKwh,
    });
    if (!beats || slotPreferences.length === 0 || compare.delta.activePlan !== "b") {
        return { plan, compare, writebackApplied: false };
    }
    const next = clonePlan(plan);
    const active = build_1.COMPARE_ELIGIBLE_GOVERNED_IDS.filter((id) => allowedAddonIds.includes(id));
    for (const id of active) {
        const prefix = (0, build_1.contributionPrefixForCompare)(id);
        const template = next.slots.flatMap((s) => flexEntries(s, prefix)).find((a) => (a.allocatedPowerW ?? 0) > 0) ??
            next.slots.flatMap((s) => flexEntries(s, prefix))[0] ??
            null;
        const newW = redistributeEligible(next, id, slotPreferences);
        next.slots.forEach((slot, idx) => {
            applyNewPowerToFlex(slot, prefix, newW[idx] ?? 0, next.slotMinutes, template);
            recomputeSlotAggregates(slot);
        });
    }
    next.allocations = next.slots.flatMap((s) => s.allocations);
    next.reasonDe = `${plan.reasonDe} | KI Plan B aktiv (Write-back).`.slice(0, 480);
    compare.delta.decisionReasonDe =
        `Plan B angewendet auf Allocation (ΔKosten ${compare.delta.deltaCostCt.toFixed(1)} ct).`;
    return { plan: next, compare, writebackApplied: true };
}
exports.applyAiPreferencesToDailyPlan = applyAiPreferencesToDailyPlan;
