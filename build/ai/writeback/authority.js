"use strict";
/**
 * Beta AI Authority Boundary (Schritt 7 Final Gate).
 *
 * Learning → Input → Unified Planner = autoritative Allocation.
 * AI erklärt / vergleicht / empfiehlt — mutiert keine Live-Slices.
 *
 * Plan-B-Simulation (`applyAiPreferencesToDailyPlan`) bleibt für Compare/Advisory erhalten,
 * wird aber nicht mehr still als Live-Authority angewendet.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanBAdvisory = exports.AI_ALLOCATION_LIVE_MUTATION_ENABLED = void 0;
/** Live-Mutation von Daily-/Unified-Allocations durch AI — für Beta aus. */
exports.AI_ALLOCATION_LIVE_MUTATION_ENABLED = false;
function buildPlanBAdvisory(compare) {
    const preferred = compare.delta.activePlan === "b";
    const base = compare.delta.decisionReasonDe.replace(/Write-back auf Allocation wenn KI aktiv\.?/i, "advisory only — Unified bleibt autoritativ.");
    const reason = preferred
        ? `Plan B advisory (kein Live-Write-back): ${base}`.slice(0, 480)
        : base;
    return {
        schemaVersion: 1,
        purpose: "plan_b_advisory",
        planBPreferred: preferred,
        activePlanLabel: compare.delta.activePlan,
        decisionReasonDe: reason,
        deltaCostCt: compare.delta.deltaCostCt,
        mutatesAllocations: false,
        mutatesLiveSlices: false,
    };
}
exports.buildPlanBAdvisory = buildPlanBAdvisory;
