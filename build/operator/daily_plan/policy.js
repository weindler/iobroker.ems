"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resolvePolicySnapshotForPlan = exports.gridImportEffective = exports.sortAllocationCandidates = exports.compareAllocationCandidates = exports.buildAllocationCandidate = exports.resolveMutualExclusionAddonId = exports.isMutualExclusionPair = exports.policyOrderFor = exports.matchesPolicyRef = exports.contributionAddonId = void 0;
const contribution_ids_1 = require("../contribution_ids");
const NON_ALLOCATABLE_IDS = new Set([
    contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE,
    contribution_ids_1.CONTRIBUTION_IDS.BATTERY_RESERVE,
    contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY,
    contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED,
    contribution_ids_1.CONTRIBUTION_IDS.WEATHER_CONTEXT,
    contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY,
    contribution_ids_1.CONTRIBUTION_IDS.HOUSE_MAIN_FUSE,
    contribution_ids_1.CONTRIBUTION_IDS.GLOBAL_CONSTRAINTS,
]);
const BLOCKING_STATUSES = new Set(["disabled", "blocked", "unsupported", "missing", "invalid"]);
function contributionAddonId(contributionId, contributorId) {
    if (contributorId.startsWith("air_conditioning.unit_"))
        return "air_conditioning";
    return contributorId;
}
exports.contributionAddonId = contributionAddonId;
function matchesPolicyRef(ref, contributionId, addonId) {
    const r = ref.trim();
    if (!r)
        return false;
    if (r === contributionId)
        return true;
    if (r === addonId)
        return true;
    return false;
}
exports.matchesPolicyRef = matchesPolicyRef;
function policyOrderFor(contributionId, addonId, energyPriority) {
    for (let i = 0; i < energyPriority.length; i++) {
        if (matchesPolicyRef(energyPriority[i], contributionId, addonId)) {
            return i;
        }
    }
    return energyPriority.length + 1000;
}
exports.policyOrderFor = policyOrderFor;
function isMutualExclusionPair(a, b, rules) {
    for (const rule of rules) {
        if ((a === rule.addonA && b === rule.addonB) ||
            (a === rule.addonB && b === rule.addonA) ||
            (matchesPolicyRef(rule.addonA, a, a) && matchesPolicyRef(rule.addonB, b, b)) ||
            (matchesPolicyRef(rule.addonA, b, b) && matchesPolicyRef(rule.addonB, a, a))) {
            return true;
        }
    }
    return false;
}
exports.isMutualExclusionPair = isMutualExclusionPair;
function resolveMutualExclusionAddonId(contributionId, addonId, rules) {
    return addonId || contributionAddonId(contributionId, addonId);
}
exports.resolveMutualExclusionAddonId = resolveMutualExclusionAddonId;
function requiredEnergyFromContribution(c) {
    const fromDetails = c.details.requiredEnergyKwh;
    if (typeof fromDetails === "number" && Number.isFinite(fromDetails)) {
        return Math.max(0, fromDetails);
    }
    const slotNeed = c.slots.find((s) => s.requiredEnergyKwh !== null)?.requiredEnergyKwh;
    if (typeof slotNeed === "number" && Number.isFinite(slotNeed)) {
        return Math.max(0, slotNeed);
    }
    return null;
}
function maxPowerFromContribution(c) {
    const fromDetails = c.details.maxChargePowerW ?? c.details.maxPowerW ?? c.details.expectedPeakW;
    if (typeof fromDetails === "number" && Number.isFinite(fromDetails) && fromDetails > 0) {
        return fromDetails;
    }
    const slotMax = c.slots.find((s) => s.maxPowerW !== null)?.maxPowerW;
    if (typeof slotMax === "number" && Number.isFinite(slotMax) && slotMax > 0) {
        return slotMax;
    }
    return null;
}
function buildAllocationCandidate(c, globalMode, energyPriority) {
    const addonId = c.contributor.addonId ?? c.contributor.id;
    const contributionId = c.contributionId;
    const mandatory = contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY ||
        c.slots.some((s) => s.mandatory) ||
        c.details.mandatory === true;
    const forced = globalMode === "forced" || c.details.thermalMode === "force";
    const hasDeadline = c.deadlineIso !== null && c.deadlineIso.trim().length > 0;
    const pvFirst = contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE || c.details.pvFirst === true;
    const gridEligible = c.gridEligible && !pvFirst;
    const batteryEligible = c.details.batteryEligible === true;
    let allocatable = true;
    let allocationStatus = "allocated";
    let reasonDe = c.reasonDe || c.quality.reasonDe;
    if (NON_ALLOCATABLE_IDS.has(contributionId) || c.flow === "constraint" || c.flow === "provide") {
        allocatable = false;
        allocationStatus =
            contributionId === contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE ? "unsupported" : "disabled";
        reasonDe =
            contributionId === contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE
                ? "Entladung nicht unterstützt — keine Allocation."
                : "Constraint-Beitrag — keine Verbrauchs-Allocation.";
    }
    else if (!c.enabled) {
        allocatable = false;
        allocationStatus = "disabled";
    }
    else if (BLOCKING_STATUSES.has(c.quality.status)) {
        allocatable = false;
        allocationStatus =
            c.quality.status === "blocked"
                ? "blocked"
                : c.quality.status === "unsupported"
                    ? "unsupported"
                    : c.quality.status === "missing"
                        ? "missing_data"
                        : "disabled";
    }
    else if (requiredEnergyFromContribution(c) === null && !mandatory) {
        allocationStatus = "missing_data";
        reasonDe = "Energiebedarf nicht belastbar — keine Allocation.";
    }
    const policyOrder = policyOrderFor(contributionId, addonId, energyPriority);
    return {
        contribution: c,
        contributionId,
        addonId,
        mandatory,
        forced,
        hasDeadline,
        deadlineIso: c.deadlineIso,
        gridEligible,
        pvFirst,
        batteryEligible,
        maxPowerW: maxPowerFromContribution(c),
        requiredEnergyKwh: requiredEnergyFromContribution(c),
        priorityRank: c.priorityBand ?? null,
        policyOrder,
        priorityBand: c.priorityBand ?? null,
        allocatable,
        allocationStatus,
        reasonDe,
    };
}
exports.buildAllocationCandidate = buildAllocationCandidate;
function compareAllocationCandidates(a, b) {
    if (a.mandatory !== b.mandatory)
        return a.mandatory ? -1 : 1;
    if (a.forced !== b.forced)
        return a.forced ? -1 : 1;
    if (a.hasDeadline !== b.hasDeadline)
        return a.hasDeadline ? -1 : 1;
    if (a.policyOrder !== b.policyOrder)
        return a.policyOrder - b.policyOrder;
    const bandA = a.priorityBand ?? 9999;
    const bandB = b.priorityBand ?? 9999;
    if (bandA !== bandB)
        return bandA - bandB;
    return a.contributionId.localeCompare(b.contributionId);
}
exports.compareAllocationCandidates = compareAllocationCandidates;
function sortAllocationCandidates(candidates) {
    return [...candidates].sort(compareAllocationCandidates);
}
exports.sortAllocationCandidates = sortAllocationCandidates;
function gridImportEffective(slotImportAllowed, policyAllowed, modeAllowsOptimization, globalMode) {
    if (!modeAllowsOptimization || globalMode === "off")
        return false;
    if (policyAllowed === false)
        return false;
    return slotImportAllowed;
}
exports.gridImportEffective = gridImportEffective;
function resolvePolicySnapshotForPlan(policySnapshot, energyPriority, mutualExclusions, gridImportAllowedPolicy, effectiveMaxGridImportW, configuredHouseFuseLimitW, batteryConsumerAccess) {
    return {
        policySnapshot: {
            energyPriority,
            gridImportAllowed: gridImportAllowedPolicy,
            effectiveMaxGridImportW,
            configuredHouseFuseLimitW,
            effectivePolicyPresent: policySnapshot !== null,
        },
        constraintSnapshot: {
            effectiveMaxGridImportW,
            configuredHouseFuseLimitW,
            mutualExclusions,
            batteryConsumers: batteryConsumerAccess
                ? Object.fromEntries(Object.entries(batteryConsumerAccess).map(([k, v]) => [
                    k,
                    v
                        ? {
                            allowed: v.allowed,
                            reasonDe: v.reasonDe,
                            minSocPct: v.minSocPct,
                        }
                        : null,
                ]))
                : {},
        },
    };
}
exports.resolvePolicySnapshotForPlan = resolvePolicySnapshotForPlan;
