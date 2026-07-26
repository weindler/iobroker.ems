"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.allocationQualityFromUnallocated = exports.buildAllocationCandidates = exports.runAllocation = exports.effectiveMinPowerW = void 0;
const quality_1 = require("../quality");
const policy_1 = require("./policy");
const slots_1 = require("./slots");
const battery_consumers_1 = require("../../policy/battery_consumers");
const device_config_1 = require("../../addons/immersion_heater/device_config");
const SLOT_MINUTES = 15;
/**
 * Effektive Mindestleistung für Allocation. Contribution.minPowerW hat Vorrang;
 * für Heizstab/Klima greift ein Fallback, damit nie wieder 8-W-Mikro-Slots entstehen,
 * falls die Contribution kein minPowerW geliefert hat.
 */
function effectiveMinPowerW(candidate) {
    if (candidate.minPowerW !== null && candidate.minPowerW > 0) {
        return candidate.minPowerW;
    }
    if (candidate.contributionId.startsWith("immersion_heater")) {
        if (candidate.maxPowerW !== null && candidate.maxPowerW > 0) {
            return Math.min(candidate.maxPowerW, device_config_1.SINGLE_STAGE_DEFAULT_NOMINAL_W);
        }
        return device_config_1.SINGLE_STAGE_DEFAULT_NOMINAL_W;
    }
    if (candidate.contributionId.startsWith("air_conditioning")) {
        return candidate.maxPowerW !== null && candidate.maxPowerW > 0 ? candidate.maxPowerW : null;
    }
    return null;
}
exports.effectiveMinPowerW = effectiveMinPowerW;
function round3(n) {
    return Math.round(n * 1000) / 1000;
}
function slotKeyInternal(slot) {
    return `${slot.slot.startIso}|${slot.slot.endIso}`;
}
function isGridBlockedInSlot(candidate, gridAllocatedAddonIds, mutualExclusions) {
    const addonId = (0, policy_1.resolveMutualExclusionAddonId)(candidate.contributionId, candidate.addonId, mutualExclusions);
    for (const otherAddonId of gridAllocatedAddonIds.values()) {
        if (otherAddonId === addonId)
            continue;
        if ((0, policy_1.isMutualExclusionPair)(addonId, otherAddonId, mutualExclusions)) {
            return true;
        }
    }
    return false;
}
function createAllocationEntry(candidate, slot, allocatedPowerW, pvPowerW, gridPowerW, batteryPowerW, status, energySource, reasonDe, requestedEnergyKwh) {
    const allocatedEnergyKwh = (0, slots_1.energyKwhFromPower)(allocatedPowerW, SLOT_MINUTES);
    let estimatedCostCt = null;
    if (gridPowerW > 0 && slot.gridPriceCtPerKwh !== null) {
        estimatedCostCt = round3((0, slots_1.energyKwhFromPower)(gridPowerW, SLOT_MINUTES) * slot.gridPriceCtPerKwh);
    }
    return {
        contributionId: candidate.contributionId,
        contributor: candidate.contribution.contributor,
        slot: slot.slot,
        status,
        energySource,
        requestedPowerW: candidate.maxPowerW,
        allocatedPowerW,
        requestedEnergyKwh,
        allocatedEnergyKwh,
        gridPowerW,
        pvPowerW,
        batteryPowerW,
        mandatory: candidate.mandatory,
        priorityRank: candidate.priorityRank,
        deadlineIso: candidate.deadlineIso,
        estimatedCostCt,
        reasonDe,
    };
}
function applyAllocationToSlot(slot, entry) {
    slot.allocations.push(entry);
    slot.allocatedFlexiblePowerW += entry.allocatedPowerW ?? 0;
    slot.allocatedPvPowerW += entry.pvPowerW;
    slot.allocatedGridPowerW += entry.gridPowerW;
    slot.allocatedBatteryPowerW += entry.batteryPowerW ?? 0;
    if (slot.remainingPvSurplusPowerW !== null) {
        slot.remainingPvSurplusPowerW = Math.max(0, slot.remainingPvSurplusPowerW - entry.pvPowerW);
    }
    if (slot.remainingGridImportPowerWAfterAlloc !== null) {
        slot.remainingGridImportPowerWAfterAlloc = Math.max(0, slot.remainingGridImportPowerWAfterAlloc - entry.gridPowerW);
    }
    if (slot.remainingBatteryDischargePowerW !== null) {
        slot.remainingBatteryDischargePowerW = Math.max(0, slot.remainingBatteryDischargePowerW - (entry.batteryPowerW ?? 0));
    }
}
function gridAddonIdsInSlot(slot, mutualExclusions) {
    const map = new Map();
    for (const a of slot.allocations) {
        if (a.gridPowerW > 0) {
            map.set(a.contributionId, (0, policy_1.resolveMutualExclusionAddonId)(a.contributionId, a.contributor.id, mutualExclusions));
        }
    }
    return map;
}
function tryAllocateInSlot(candidate, slot, remaining, gridAllowed, gridAddonIds, mutualExclusions, forceMinPowerW, batteryAllowedForCandidate) {
    if (remaining.remainingKwh <= 0)
        return null;
    const maxFromEnergy = (0, slots_1.powerWFromEnergyKwh)(remaining.remainingKwh, SLOT_MINUTES);
    const minW = effectiveMinPowerW(candidate);
    // Restenergie unter kleinster fahrbarer Stufe → kein Mikro-Slot (Runtime könnte ihn ohnehin nicht schalten).
    if (minW !== null && maxFromEnergy < minW && (forceMinPowerW === null || forceMinPowerW < minW)) {
        return null;
    }
    let targetW = forceMinPowerW ?? maxFromEnergy;
    if (minW !== null)
        targetW = Math.max(targetW, minW);
    if (candidate.maxPowerW !== null)
        targetW = Math.min(targetW, candidate.maxPowerW);
    if (targetW <= 0)
        return null;
    if (minW !== null && targetW < minW)
        return null;
    let pvW = 0;
    let gridW = 0;
    let batteryW = 0;
    if (slot.remainingPvSurplusPowerW !== null && slot.remainingPvSurplusPowerW > 0) {
        pvW = Math.min(targetW, slot.remainingPvSurplusPowerW);
    }
    let rest = targetW - pvW;
    if (candidate.batteryEligible &&
        batteryAllowedForCandidate &&
        rest > 0 &&
        slot.remainingBatteryDischargePowerW !== null &&
        slot.remainingBatteryDischargePowerW > 0) {
        batteryW = Math.min(rest, slot.remainingBatteryDischargePowerW);
        rest -= batteryW;
    }
    if (candidate.gridEligible &&
        !candidate.pvFirst &&
        gridAllowed &&
        rest > 0 &&
        slot.remainingGridImportPowerWAfterAlloc !== null &&
        slot.remainingGridImportPowerWAfterAlloc > 0 &&
        !isGridBlockedInSlot(candidate, gridAddonIds, mutualExclusions)) {
        gridW = Math.min(rest, slot.remainingGridImportPowerWAfterAlloc);
    }
    const allocatedW = pvW + gridW + batteryW;
    if (allocatedW <= 0)
        return null;
    // Teil-Surplus unter minW nicht als Schein-Allocation speichern.
    if (minW !== null && allocatedW < minW)
        return null;
    const sources = [pvW > 0, gridW > 0, batteryW > 0].filter(Boolean).length;
    let energySource = "none";
    if (sources > 1)
        energySource = "mixed";
    else if (pvW > 0)
        energySource = "pv_surplus";
    else if (batteryW > 0)
        energySource = "battery";
    else if (gridW > 0)
        energySource = "grid";
    const reasonDe = energySource === "pv_surplus"
        ? "PV-Überschuss zugewiesen."
        : energySource === "battery"
            ? "Hausbatterie zugewiesen (Policy/Operator)."
            : energySource === "grid"
                ? "Netzenergie zugewiesen."
                : "Gemischte Zuweisung (PV/Batterie/Netz).";
    const entry = createAllocationEntry(candidate, slot, allocatedW, pvW, gridW, batteryW, "allocated", energySource, reasonDe, remaining.requestedKwh);
    remaining.remainingKwh = round3(Math.max(0, remaining.remainingKwh - (entry.allocatedEnergyKwh ?? 0)));
    applyAllocationToSlot(slot, entry);
    return entry;
}
function batteryAllowedForCandidate(candidate, access) {
    if (!candidate.batteryEligible)
        return false;
    const id = (0, battery_consumers_1.batteryConsumerIdFromAddon)(candidate.addonId);
    if (!id || !access)
        return false;
    return access[id]?.allowed === true;
}
function runAllocation(input) {
    const budget = input.batteryDischargeBudgetW !== undefined && input.batteryDischargeBudgetW !== null
        ? Math.max(0, Math.round(input.batteryDischargeBudgetW))
        : null;
    const slots = input.slots.map((s) => ({
        ...s,
        allocations: [...s.allocations],
        remainingPvSurplusPowerW: s.remainingPvSurplusPowerW,
        remainingGridImportPowerWAfterAlloc: s.remainingGridImportPowerWAfterAlloc,
        remainingBatteryDischargePowerW: budget,
        allocatedBatteryPowerW: 0,
    }));
    const allEntries = [];
    const unallocated = [];
    const remainingById = new Map();
    for (const c of input.candidates) {
        if (!c.allocatable && !c.mandatory)
            continue;
        const req = c.requiredEnergyKwh;
        if (req === null && !c.mandatory)
            continue;
        remainingById.set(c.contributionId, {
            contributionId: c.contributionId,
            remainingKwh: req ?? 0,
            requestedKwh: req,
        });
    }
    if (input.globalMode === "off" || !input.modeAllowsOptimization) {
        for (const c of input.candidates) {
            if (c.mandatory && c.requiredEnergyKwh !== null && c.requiredEnergyKwh > 0) {
                unallocated.push({
                    contributionId: c.contributionId,
                    requestedEnergyKwh: c.requiredEnergyKwh,
                    allocatedEnergyKwh: 0,
                    unallocatedEnergyKwh: c.requiredEnergyKwh,
                    reasonDe: "Global Mode off — keine Allocation, Pflichtbedarf dokumentiert.",
                });
            }
        }
        return { slots, allocations: allEntries, unallocated };
    }
    const allocatable = input.candidates.filter((c) => c.allocatable);
    const mandatory = (0, policy_1.sortAllocationCandidates)(allocatable.filter((c) => c.mandatory));
    const deadline = (0, policy_1.sortAllocationCandidates)(allocatable.filter((c) => c.hasDeadline && !c.mandatory));
    const flexible = (0, policy_1.sortAllocationCandidates)(allocatable.filter((c) => !c.mandatory && !c.hasDeadline));
    const gridAllowedForSlot = (slot) => (0, policy_1.gridImportEffective)(slot.gridImportAllowed, input.gridImportAllowedPolicy, input.modeAllowsOptimization, input.globalMode);
    const batOk = (c) => batteryAllowedForCandidate(c, input.batteryConsumerAccess);
    for (const candidate of mandatory) {
        const rem = remainingById.get(candidate.contributionId);
        if (!rem)
            continue;
        for (const slot of slots) {
            if (rem.remainingKwh <= 0)
                break;
            const entry = tryAllocateInSlot(candidate, slot, rem, gridAllowedForSlot(slot) && candidate.gridEligible, gridAddonIdsInSlot(slot, input.mutualExclusions), input.mutualExclusions, null, batOk(candidate));
            if (entry)
                allEntries.push(entry);
        }
    }
    for (const candidate of deadline) {
        const rem = remainingById.get(candidate.contributionId);
        if (!rem || !candidate.deadlineIso)
            continue;
        const eligible = (0, slots_1.slotsUntilDeadline)(slots.map((s) => s.slot), candidate.deadlineIso, input.nowMs);
        const eligibleKeys = new Set(eligible.map((s) => `${s.startIso}|${s.endIso}`));
        const deadlineSlots = slots
            .filter((s) => eligibleKeys.has(slotKeyInternal(s)))
            .sort((a, b) => {
            const pa = a.gridPriceCtPerKwh ?? 9999;
            const pb = b.gridPriceCtPerKwh ?? 9999;
            return pa - pb || a.slot.startIso.localeCompare(b.slot.startIso);
        });
        const minW = (0, slots_1.minPowerForDeadline)(rem.remainingKwh, deadlineSlots.map((s) => s.slot), SLOT_MINUTES, candidate.maxPowerW);
        for (const slot of deadlineSlots) {
            if (rem.remainingKwh <= 0)
                break;
            const entry = tryAllocateInSlot(candidate, slot, rem, gridAllowedForSlot(slot) && candidate.gridEligible, gridAddonIdsInSlot(slot, input.mutualExclusions), input.mutualExclusions, minW, batOk(candidate));
            if (entry)
                allEntries.push(entry);
        }
    }
    for (const candidate of flexible) {
        const rem = remainingById.get(candidate.contributionId);
        if (!rem)
            continue;
        const orderedSlots = candidate.gridEligible
            ? [...slots].sort((a, b) => {
                const pa = a.gridPriceCtPerKwh ?? 9999;
                const pb = b.gridPriceCtPerKwh ?? 9999;
                return pa - pb || a.slot.startIso.localeCompare(b.slot.startIso);
            })
            : slots;
        for (const slot of orderedSlots) {
            if (rem.remainingKwh <= 0)
                break;
            const entry = tryAllocateInSlot(candidate, slot, rem, gridAllowedForSlot(slot) && candidate.gridEligible, gridAddonIdsInSlot(slot, input.mutualExclusions), input.mutualExclusions, null, batOk(candidate));
            if (entry)
                allEntries.push(entry);
        }
    }
    for (const c of allocatable) {
        const rem = remainingById.get(c.contributionId);
        if (!rem) {
            if (c.requiredEnergyKwh === null) {
                unallocated.push({
                    contributionId: c.contributionId,
                    requestedEnergyKwh: null,
                    allocatedEnergyKwh: 0,
                    unallocatedEnergyKwh: null,
                    reasonDe: c.reasonDe || "Kein belastbarer Energiebedarf.",
                });
            }
            continue;
        }
        const allocated = round3((rem.requestedKwh ?? 0) - rem.remainingKwh);
        if (rem.remainingKwh > 0.001) {
            const remPowerW = (0, slots_1.powerWFromEnergyKwh)(rem.remainingKwh, SLOT_MINUTES);
            const minW = effectiveMinPowerW(c);
            let reason = "Bedarf nicht vollständig zuweisbar.";
            if (minW !== null && allocated < 0.001) {
                reason = `Keine fahrbare Leistung (≥ ${Math.round(minW)} W) verfügbar — Bedarf zu klein oder PV-Surplus unter Mindeststufe.`;
            }
            else if (minW !== null && remPowerW < minW) {
                reason = `Rest unter kleinster fahrbarer Stufe (≥ ${Math.round(minW)} W) — nicht als Mikro-Slot geplant.`;
            }
            else if (c.pvFirst && !c.batteryEligible) {
                reason = "PV-first — kein ausreichender PV-Überschuss in belastbaren Slots.";
            }
            else if (c.pvFirst && c.batteryEligible) {
                reason = "PV/Batterie-Budget reicht nicht für den Bedarf.";
            }
            else if (!c.gridEligible) {
                reason = "Netzbezug für diesen Beitrag nicht freigegeben.";
            }
            else if (slots.every((s) => s.availablePvSurplusPowerW === null)) {
                reason = "Kein zeitaufgelöster PV-Forecast — PV-Allocation nicht möglich.";
            }
            unallocated.push({
                contributionId: c.contributionId,
                requestedEnergyKwh: rem.requestedKwh,
                allocatedEnergyKwh: allocated,
                unallocatedEnergyKwh: round3(rem.remainingKwh),
                reasonDe: reason,
            });
        }
    }
    return { slots, allocations: allEntries, unallocated };
}
exports.runAllocation = runAllocation;
function buildAllocationCandidates(contributions, globalMode, energyPriority) {
    return contributions.map((c) => (0, policy_1.buildAllocationCandidate)(c, globalMode, energyPriority));
}
exports.buildAllocationCandidates = buildAllocationCandidates;
function allocationQualityFromUnallocated(unallocated, hasMandatoryGap) {
    if (hasMandatoryGap) {
        return (0, quality_1.operatorQuality)("degraded", "Pflichtbedarf nicht vollständig alloziert.");
    }
    if (unallocated.some((u) => (u.unallocatedEnergyKwh ?? 0) > 0)) {
        return (0, quality_1.operatorQuality)("degraded", "Flexible Bedarfe teilweise nicht zugewiesen.");
    }
    return (0, quality_1.operatorQuality)("valid", "Daily Plan Allocation bereit.");
}
exports.allocationQualityFromUnallocated = allocationQualityFromUnallocated;
