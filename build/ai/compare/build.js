"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildCompareResult = exports.isMeaningfulPowerShift = exports.totalPowerShiftW = exports.planBBeatsPlanA = exports.contributionPrefixForCompare = exports.COMPARE_ELIGIBLE_GOVERNED_IDS = void 0;
const registry_1 = require("../../addons/governance/registry");
const redistribute_1 = require("./redistribute");
/**
 * Governance-IDs für Plan-Vergleich / Write-back.
 * Block 6: IH + Klima. Block 10: + Batterie-Laden + Wallbox (kein EMS-Entladen).
 */
exports.COMPARE_ELIGIBLE_GOVERNED_IDS = ["immersion_heater", "climate", "battery", "wallbox"];
const COST_EPSILON_CT = 0.01;
const ENERGY_EPSILON_KWH = 0.001;
/**
 * Contribution-Präfix für Flex-Zeilen.
 * Batterie: nur `battery.charge` — nie discharge/reserve.
 * Wallbox: nur `wallbox.ev_session`.
 */
function contributionPrefixForCompare(governedId) {
    if (governedId === "battery")
        return "battery.charge";
    if (governedId === "wallbox")
        return "wallbox.ev_session";
    return (0, registry_1.governedAddonEntry)(governedId).runtimeAddonId;
}
exports.contributionPrefixForCompare = contributionPrefixForCompare;
/** Max. leichte Kostensteigerung (ct), wenn PV klar steigt und Netz nicht zunimmt. */
const STRATEGY_COST_SLACK_CT = 2;
const STRATEGY_PV_GAIN_KWH = 0.2;
/** Relative Verbesserung der Surplus-Ausrichtung (gewichtete W·kWh), ab der Plan B gewinnt. */
const SURPLUS_ALIGN_REL = 0.08;
const SURPLUS_ALIGN_ABS_WHW = 50_000;
/** L1-Leistungsverschiebung (W über alle Slots), ab der ein Shift „echt“ ist. */
const MEANINGFUL_SHIFT_W = 200;
/**
 * Plan B muss Plan A messbar schlagen (Kosten primär, sonst Netz↓ / PV↑ / Surplus-Ausrichtung).
 * Leicht teurer Plan B darf gewinnen bei klarem PV- oder Alignment-Gewinn ohne Mehr-Netz.
 */
function planBBeatsPlanA(input) {
    if (input.deltaCostCt < -COST_EPSILON_CT)
        return true;
    if (Math.abs(input.deltaCostCt) <= COST_EPSILON_CT) {
        if (input.deltaGridKwh < -ENERGY_EPSILON_KWH)
            return true;
        if (input.deltaPvKwh > ENERGY_EPSILON_KWH && input.deltaGridKwh <= ENERGY_EPSILON_KWH)
            return true;
    }
    // Leicht teurer, aber klar bessere PV-Ausrichtung und kein Mehr-Netz → Strategie-Win.
    if (input.deltaCostCt <= STRATEGY_COST_SLACK_CT &&
        input.deltaPvKwh >= STRATEGY_PV_GAIN_KWH &&
        input.deltaGridKwh <= ENERGY_EPSILON_KWH) {
        return true;
    }
    const dAlign = input.deltaSurplusAlign ?? 0;
    const alignA = input.surplusAlignA ?? 0;
    const alignWin = dAlign >= SURPLUS_ALIGN_ABS_WHW || (alignA > 0 && dAlign / alignA >= SURPLUS_ALIGN_REL);
    if (alignWin &&
        input.deltaCostCt <= STRATEGY_COST_SLACK_CT &&
        input.deltaGridKwh <= ENERGY_EPSILON_KWH) {
        return true;
    }
    return false;
}
exports.planBBeatsPlanA = planBBeatsPlanA;
/** Summe |newW−ownW| über alle KI-Add-ons/Slots — 0 ≈ Identität mit Plan A. */
function totalPowerShiftW(redistributions) {
    let sum = 0;
    for (const r of redistributions) {
        const n = Math.max(r.ownWPerSlot.length, r.newWPerSlot.length);
        for (let i = 0; i < n; i++) {
            sum += Math.abs((r.newWPerSlot[i] ?? 0) - (r.ownWPerSlot[i] ?? 0));
        }
    }
    return sum;
}
exports.totalPowerShiftW = totalPowerShiftW;
function isMeaningfulPowerShift(shiftW) {
    return shiftW >= MEANINGFUL_SHIFT_W;
}
exports.isMeaningfulPowerShift = isMeaningfulPowerShift;
/** Flexible (nicht-mandatory) Leistung/PV-Anteil eines Contribution-Präfixes in einem Slot (Plan A). */
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
function buildAddonRedistribution(plan, governedId, slotPreferences, options) {
    const prefix = contributionPrefixForCompare(governedId);
    const ownWPerSlot = [];
    const ownPvWPerSlot = [];
    const capacityPerSlot = [];
    const multipliers = [];
    const wallboxPvOnly = options?.wallboxPvOnly === true && governedId === "wallbox";
    const weightByIso = new Map(slotPreferences.filter((p) => p.addonId === governedId).map((p) => [p.slotStartIso, p.weight]));
    /** Früheste Deadline der Flex-Zeilen — Wallbox darf Energie nicht hinter die Deadline schieben. */
    let deadlineMs = null;
    if (governedId === "wallbox") {
        for (const slot of plan.slots) {
            for (const a of slot.allocations) {
                if (a.mandatory || !a.contributionId.startsWith(prefix) || !a.deadlineIso)
                    continue;
                const t = Date.parse(a.deadlineIso);
                if (!Number.isFinite(t))
                    continue;
                deadlineMs = deadlineMs === null ? t : Math.min(deadlineMs, t);
            }
        }
    }
    for (const slot of plan.slots) {
        const { ownW, ownPvW } = slotOwnUsage(slot, prefix);
        const remainingPv = Math.max(0, slot.remainingPvSurplusPowerW ?? 0);
        const remainingGrid = slot.gridImportAllowed ? Math.max(0, slot.remainingGridImportPowerWAfterAlloc ?? 0) : 0;
        ownWPerSlot.push(ownW);
        ownPvWPerSlot.push(ownPvW);
        let capacityW = wallboxPvOnly
            ? Math.max(ownW, ownW + remainingPv)
            : Math.max(ownW, ownW + remainingPv + remainingGrid);
        if (deadlineMs !== null) {
            const slotStartMs = Date.parse(slot.slot.startIso);
            // Nach Deadline: nur vorhandene Leistung halten (kein Zuzug), davor normal.
            if (Number.isFinite(slotStartMs) && slotStartMs >= deadlineMs) {
                capacityW = ownW;
            }
        }
        capacityPerSlot.push(capacityW);
        multipliers.push(weightByIso.get(slot.slot.startIso) ?? 1);
    }
    // Compare bleibt energieerhaltend (keine Stage-Coalesce) — Coalesce nur beim Write-back.
    const newWPerSlot = (0, redistribute_1.redistributeAddonAcrossSlots)(ownWPerSlot.map((ownW, i) => ({ ownW, capacityW: capacityPerSlot[i] })), multipliers);
    return { governedId, prefix, ownWPerSlot, ownPvWPerSlot, newWPerSlot };
}
function emptyTotals() {
    return { costCt: 0, pvKwh: 0, gridKwh: 0, unallocatedKwh: null, ihKwh: 0, acKwh: 0, batKwh: 0, wbKwh: 0 };
}
function round1(n) {
    return Math.round(n * 10) / 10;
}
/**
 * Baut den vollständigen Plan-Vergleich (Plan A vs. simulierter Plan B) aus einem Daily Plan und
 * den zuletzt gespeicherten KI-Zeitpunkt-Präferenzen. `allowedAddonIds` sind die Governance-IDs, die
 * aktiv UND für KI-Optimierung freigegeben sind (siehe src/ai/context.ts resolveAllowedAddonIds).
 */
function buildCompareResult(plan, allowedAddonIds, slotPreferences, options) {
    const durationH = plan.slotMinutes / 60;
    const activeGovernedIds = exports.COMPARE_ELIGIBLE_GOVERNED_IDS.filter((id) => allowedAddonIds.includes(id));
    const redistributions = new Map();
    for (const id of activeGovernedIds) {
        redistributions.set(id, buildAddonRedistribution(plan, id, slotPreferences, options));
    }
    const ordered = activeGovernedIds
        .map((id) => redistributions.get(id))
        .filter((r) => r != null);
    const chartA = [];
    const chartB = [];
    const totalsA = emptyTotals();
    const totalsB = emptyTotals();
    let surplusAlignA = 0;
    let surplusAlignB = 0;
    plan.slots.forEach((slot, idx) => {
        const priceCt = slot.gridPriceCtPerKwh;
        const surplusW = Math.max(0, slot.availablePvSurplusPowerW ?? 0);
        const byId = (id) => {
            const r = redistributions.get(id);
            if (!r)
                return { ownW: 0, ownPvW: 0, newW: 0 };
            return {
                ownW: r.ownWPerSlot[idx] ?? 0,
                ownPvW: r.ownPvWPerSlot[idx] ?? 0,
                newW: r.newWPerSlot[idx] ?? 0,
            };
        };
        const ih = byId("immersion_heater");
        const ac = byId("climate");
        const bat = byId("battery");
        const wb = byId("wallbox");
        const pvWA = slot.allocatedPvPowerW;
        const gridWA = slot.allocatedGridPowerW;
        const sumOwnPv = ordered.reduce((s, r) => s + (r.ownPvWPerSlot[idx] ?? 0), 0);
        const wantW = ordered.reduce((s, r) => s + (r.newWPerSlot[idx] ?? 0), 0);
        const nonAiPvUsed = Math.max(0, pvWA - sumOwnPv);
        const pvPoolForAiAddonsB = Math.max(0, (slot.availablePvSurplusPowerW ?? pvWA) - nonAiPvUsed);
        // Sequentiell (Reihenfolge COMPARE_ELIGIBLE) — gleiches Muster wie früher IH→Klima.
        let remainingPvPool = pvPoolForAiAddonsB;
        const pvBById = new Map();
        for (const r of ordered) {
            const newW = r.newWPerSlot[idx] ?? 0;
            const pvShare = wantW > 0 ? Math.min(newW, remainingPvPool * (newW / wantW)) : 0;
            pvBById.set(r.governedId, pvShare);
            remainingPvPool = Math.max(0, remainingPvPool - pvShare);
        }
        const sumOwnGrid = ordered.reduce((s, r) => {
            const ownW = r.ownWPerSlot[idx] ?? 0;
            const ownPv = r.ownPvWPerSlot[idx] ?? 0;
            return s + Math.max(0, ownW - ownPv);
        }, 0);
        const sumGridB = ordered.reduce((s, r) => {
            const newW = r.newWPerSlot[idx] ?? 0;
            const pvB = pvBById.get(r.governedId) ?? 0;
            return s + Math.max(0, newW - pvB);
        }, 0);
        const sumPvB = ordered.reduce((s, r) => s + (pvBById.get(r.governedId) ?? 0), 0);
        const pvWB = Math.max(0, pvWA - sumOwnPv + sumPvB);
        const gridWB = Math.max(0, gridWA - sumOwnGrid + sumGridB);
        const ownAiW = ordered.reduce((s, r) => s + (r.ownWPerSlot[idx] ?? 0), 0);
        const newAiW = ordered.reduce((s, r) => s + (r.newWPerSlot[idx] ?? 0), 0);
        surplusAlignA += ownAiW * surplusW * durationH;
        surplusAlignB += newAiW * surplusW * durationH;
        chartA.push({
            t: slot.slot.startIso,
            pvW: Math.round(pvWA),
            gridW: Math.round(gridWA),
            ihW: Math.round(ih.ownW),
            acW: Math.round(ac.ownW),
            batW: Math.round(bat.ownW),
            wbW: Math.round(wb.ownW),
            priceCt,
        });
        chartB.push({
            t: slot.slot.startIso,
            pvW: Math.round(pvWB),
            gridW: Math.round(gridWB),
            ihW: Math.round(ih.newW),
            acW: Math.round(ac.newW),
            batW: Math.round(bat.newW),
            wbW: Math.round(wb.newW),
            priceCt,
        });
        const priceFactor = priceCt ?? 0;
        totalsA.pvKwh += (pvWA / 1000) * durationH;
        totalsA.gridKwh += (gridWA / 1000) * durationH;
        totalsA.costCt += (gridWA / 1000) * durationH * priceFactor;
        totalsA.ihKwh += (ih.ownW / 1000) * durationH;
        totalsA.acKwh += (ac.ownW / 1000) * durationH;
        totalsA.batKwh += (bat.ownW / 1000) * durationH;
        totalsA.wbKwh += (wb.ownW / 1000) * durationH;
        totalsB.pvKwh += (pvWB / 1000) * durationH;
        totalsB.gridKwh += (gridWB / 1000) * durationH;
        totalsB.costCt += (gridWB / 1000) * durationH * priceFactor;
        totalsB.ihKwh += (ih.newW / 1000) * durationH;
        totalsB.acKwh += (ac.newW / 1000) * durationH;
        totalsB.batKwh += (bat.newW / 1000) * durationH;
        totalsB.wbKwh += (wb.newW / 1000) * durationH;
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
    totalsA.batKwh = round1(totalsA.batKwh);
    totalsB.batKwh = round1(totalsB.batKwh);
    totalsA.wbKwh = round1(totalsA.wbKwh);
    totalsB.wbKwh = round1(totalsB.wbKwh);
    const deltaCostCt = round1(totalsB.costCt - totalsA.costCt);
    const deltaGridKwh = round1(totalsB.gridKwh - totalsA.gridKwh);
    const deltaPvKwh = round1(totalsB.pvKwh - totalsA.pvKwh);
    const deltaSurplusAlign = surplusAlignB - surplusAlignA;
    const shiftW = totalPowerShiftW(ordered);
    const hasFlexEnergy = ordered.some((r) => r.ownWPerSlot.some((w) => w > 0));
    const beats = planBBeatsPlanA({
        deltaCostCt,
        deltaGridKwh,
        deltaPvKwh,
        deltaSurplusAlign,
        surplusAlignA,
    });
    let activePlan = "a";
    let decisionReasonDe;
    if (activeGovernedIds.length === 0) {
        decisionReasonDe = "Kein Add-on für KI-Optimierung freigegeben — Plan-Vergleich zeigt nur Plan A.";
    }
    else if (!hasFlexEnergy) {
        decisionReasonDe =
            "Keine flexible Allocation (IH/Klima/Batterie/Wallbox) zum Verschieben — Plan A unverändert.";
    }
    else if (!isMeaningfulPowerShift(shiftW) && slotPreferences.length > 0) {
        decisionReasonDe =
            "Plan A entspricht bereits der KI-Strategie (keine messbare Slot-Verschiebung) — kein Write-back nötig.";
    }
    else if (beats) {
        activePlan = "b";
        decisionReasonDe =
            `Plan B schlägt Plan A (ΔKosten ${deltaCostCt.toFixed(1)} ct, ΔNetz ${deltaGridKwh.toFixed(2)} kWh, ` +
                `ΔPV ${deltaPvKwh.toFixed(2)} kWh) — Write-back auf Allocation wenn KI aktiv.`;
    }
    else {
        decisionReasonDe =
            `Plan B schlägt Plan A nicht messbar (ΔKosten ${deltaCostCt.toFixed(1)} ct, ` +
                `ΔNetz ${deltaGridKwh.toFixed(2)} kWh, ΔPV ${deltaPvKwh.toFixed(2)} kWh) — kein Write-back.`;
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
