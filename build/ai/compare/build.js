"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCompareResult = exports.planBBeatsPlanA = exports.COMPARE_ELIGIBLE_GOVERNED_IDS = void 0;
const registry_1 = require("../../addons/governance/registry");
const redistribute_1 = require("./redistribute");
/** Governance-IDs, die für den Plan-Vergleich überhaupt in Frage kommen (siehe Masterplan §13). */
exports.COMPARE_ELIGIBLE_GOVERNED_IDS = ["immersion_heater", "climate"];
const COST_EPSILON_CT = 0.01;
const ENERGY_EPSILON_KWH = 0.001;
/**
 * Roadmap Block 6: Plan B muss Plan A messbar schlagen (Kosten primär, sonst Netz↓ / PV↑).
 * Teurer Plan B gewinnt nie.
 */
function planBBeatsPlanA(input) {
    if (input.deltaCostCt < -COST_EPSILON_CT)
        return true;
    if (input.deltaCostCt > COST_EPSILON_CT)
        return false;
    if (input.deltaGridKwh < -ENERGY_EPSILON_KWH)
        return true;
    if (input.deltaPvKwh > ENERGY_EPSILON_KWH && input.deltaGridKwh <= ENERGY_EPSILON_KWH)
        return true;
    return false;
}
exports.planBBeatsPlanA = planBBeatsPlanA;
/** Flexible (nicht-mandatory) Leistung/PV-Anteil eines Add-on-Präfixes in einem Slot (Plan A). */
function slotOwnUsage(slot, contributionPrefix) {
    let ownW = 0;
    let ownPvW = 0;
    for (const a of slot.allocations) {
        if (a.mandatory)
            continue;
        if (!a.contributionId.startsWith(contributionPrefix))
            continue;
        ownW += a.allocatedPowerW ?? 0;
        ownPvW += a.pvPowerW ?? 0;
    }
    return { ownW, ownPvW };
}
function buildAddonRedistribution(plan, governedId, slotPreferences) {
    const prefix = (0, registry_1.governedAddonEntry)(governedId).runtimeAddonId;
    const ownWPerSlot = [];
    const ownPvWPerSlot = [];
    const capacityPerSlot = [];
    const multipliers = [];
    const weightByIso = new Map(slotPreferences.filter((p) => p.addonId === governedId).map((p) => [p.slotStartIso, p.weight]));
    for (const slot of plan.slots) {
        const { ownW, ownPvW } = slotOwnUsage(slot, prefix);
        const remainingPv = Math.max(0, slot.remainingPvSurplusPowerW ?? 0);
        const remainingGrid = slot.gridImportAllowed ? Math.max(0, slot.remainingGridImportPowerWAfterAlloc ?? 0) : 0;
        ownWPerSlot.push(ownW);
        ownPvWPerSlot.push(ownPvW);
        capacityPerSlot.push(Math.max(ownW, ownW + remainingPv + remainingGrid));
        multipliers.push(weightByIso.get(slot.slot.startIso) ?? 1);
    }
    // Compare bleibt energieerhaltend (keine Stage-Coalesce) — Coalesce nur beim Write-back.
    const newWPerSlot = (0, redistribute_1.redistributeAddonAcrossSlots)(ownWPerSlot.map((ownW, i) => ({ ownW, capacityW: capacityPerSlot[i] })), multipliers);
    return { prefix, ownWPerSlot, ownPvWPerSlot, newWPerSlot };
}
function emptyTotals() {
    return { costCt: 0, pvKwh: 0, gridKwh: 0, unallocatedKwh: null, ihKwh: 0, acKwh: 0 };
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
/**
 * Baut den vollständigen Plan-Vergleich (Plan A vs. simulierter Plan B) aus einem Daily Plan und
 * den zuletzt gespeicherten KI-Zeitpunkt-Präferenzen. `allowedAddonIds` sind die Governance-IDs, die
 * aktiv UND für KI-Optimierung freigegeben sind (siehe src/ai/context.ts resolveAllowedAddonIds).
 */
function buildCompareResult(plan, allowedAddonIds, slotPreferences) {
    const durationH = plan.slotMinutes / 60;
    const activeGovernedIds = exports.COMPARE_ELIGIBLE_GOVERNED_IDS.filter((id) => allowedAddonIds.includes(id));
    const redistributions = new Map();
    for (const id of activeGovernedIds) {
        redistributions.set(id, buildAddonRedistribution(plan, id, slotPreferences));
    }
    const ihRedist = redistributions.get("immersion_heater") ?? null;
    const acRedist = redistributions.get("climate") ?? null;
    const chartA = [];
    const chartB = [];
    const totalsA = emptyTotals();
    const totalsB = emptyTotals();
    plan.slots.forEach((slot, idx) => {
        const priceCt = slot.gridPriceCtPerKwh;
        const ihOwnW = ihRedist ? ihRedist.ownWPerSlot[idx] : 0;
        const ihOwnPvW = ihRedist ? ihRedist.ownPvWPerSlot[idx] : 0;
        const ihNewW = ihRedist ? ihRedist.newWPerSlot[idx] : ihOwnW;
        const acOwnW = acRedist ? acRedist.ownWPerSlot[idx] : 0;
        const acOwnPvW = acRedist ? acRedist.ownPvWPerSlot[idx] : 0;
        const acNewW = acRedist ? acRedist.newWPerSlot[idx] : acOwnW;
        const pvWA = slot.allocatedPvPowerW;
        const gridWA = slot.allocatedGridPowerW;
        const nonAiPvUsed = Math.max(0, pvWA - ihOwnPvW - acOwnPvW);
        const pvPoolForAiAddonsB = Math.max(0, (slot.availablePvSurplusPowerW ?? pvWA) - nonAiPvUsed);
        const wantW = ihNewW + acNewW;
        const ihPvB = wantW > 0 ? Math.min(ihNewW, pvPoolForAiAddonsB * (ihNewW / wantW)) : 0;
        const acPvB = wantW > 0 ? Math.min(acNewW, Math.max(0, pvPoolForAiAddonsB - ihPvB)) : 0;
        const ihGridA = Math.max(0, ihOwnW - ihOwnPvW);
        const acGridA = Math.max(0, acOwnW - acOwnPvW);
        const ihGridB = Math.max(0, ihNewW - ihPvB);
        const acGridB = Math.max(0, acNewW - acPvB);
        const pvWB = Math.max(0, pvWA - ihOwnPvW - acOwnPvW + ihPvB + acPvB);
        const gridWB = Math.max(0, gridWA - ihGridA - acGridA + ihGridB + acGridB);
        chartA.push({
            t: slot.slot.startIso,
            pvW: Math.round(pvWA),
            gridW: Math.round(gridWA),
            ihW: Math.round(ihOwnW),
            acW: Math.round(acOwnW),
            priceCt,
        });
        chartB.push({
            t: slot.slot.startIso,
            pvW: Math.round(pvWB),
            gridW: Math.round(gridWB),
            ihW: Math.round(ihNewW),
            acW: Math.round(acNewW),
            priceCt,
        });
        const priceFactor = priceCt ?? 0;
        totalsA.pvKwh += (pvWA / 1000) * durationH;
        totalsA.gridKwh += (gridWA / 1000) * durationH;
        totalsA.costCt += (gridWA / 1000) * durationH * priceFactor;
        totalsA.ihKwh += (ihOwnW / 1000) * durationH;
        totalsA.acKwh += (acOwnW / 1000) * durationH;
        totalsB.pvKwh += (pvWB / 1000) * durationH;
        totalsB.gridKwh += (gridWB / 1000) * durationH;
        totalsB.costCt += (gridWB / 1000) * durationH * priceFactor;
        totalsB.ihKwh += (ihNewW / 1000) * durationH;
        totalsB.acKwh += (acNewW / 1000) * durationH;
    });
    totalsA.unallocatedKwh = plan.totals.flexibleUnallocatedEnergyKwh;
    // Plan B verschiebt nur den Zeitpunkt, nie die Gesamtenergiemenge → identisch zu Plan A.
    totalsB.unallocatedKwh = plan.totals.flexibleUnallocatedEnergyKwh;
    totalsA.costCt = round1(totalsA.costCt);
    totalsB.costCt = round1(totalsB.costCt);
    totalsA.pvKwh = round1(totalsA.pvKwh);
    totalsB.pvKwh = round1(totalsB.pvKwh);
    totalsA.gridKwh = round1(totalsA.gridKwh);
    totalsB.gridKwh = round1(totalsB.gridKwh);
    totalsA.ihKwh = round1(totalsA.ihKwh);
    totalsB.ihKwh = round1(totalsB.ihKwh);
    totalsA.acKwh = round1(totalsA.acKwh);
    totalsB.acKwh = round1(totalsB.acKwh);
    const deltaCostCt = round1(totalsB.costCt - totalsA.costCt);
    const deltaGridKwh = round1(totalsB.gridKwh - totalsA.gridKwh);
    const deltaPvKwh = round1(totalsB.pvKwh - totalsA.pvKwh);
    const beats = planBBeatsPlanA({ deltaCostCt, deltaGridKwh, deltaPvKwh });
    let activePlan = "a";
    let decisionReasonDe;
    if (activeGovernedIds.length === 0) {
        decisionReasonDe = "Kein Add-on für KI-Optimierung freigegeben — Plan-Vergleich zeigt nur Plan A.";
    }
    else if (beats) {
        activePlan = "b";
        decisionReasonDe =
            `Plan B schlägt Plan A (ΔKosten ${deltaCostCt.toFixed(1)} ct, ΔNetz ${deltaGridKwh.toFixed(2)} kWh, ` +
                `ΔPV ${deltaPvKwh.toFixed(2)} kWh) — Write-back auf Allocation wenn KI aktiv.`;
    }
    else {
        decisionReasonDe =
            "Plan B schlägt Plan A nicht messbar (Kosten/PV/Netz) — Plan B verworfen, KI-Auto aus.";
    }
    const delta = {
        planA: totalsA,
        planB: totalsB,
        deltaCostCt,
        activePlan,
        decisionReasonDe,
        aiInvolvedAddonIds: activeGovernedIds,
    };
    return {
        generatedAt: new Date().toISOString(),
        planRevision: plan.revision,
        chartA,
        chartB,
        delta,
    };
}
exports.buildCompareResult = buildCompareResult;
