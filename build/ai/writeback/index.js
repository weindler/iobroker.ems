"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanBAdvisory = exports.AI_ALLOCATION_LIVE_MUTATION_ENABLED = exports.republishDailyPlanAfterWriteback = exports.applyAiPreferencesToDailyPlan = exports.finalizeAiRunWithWritebackGate = exports.maybeApplyAiWritebackOnDailyPlan = exports.clearAiAutoSuspend = exports.suspendAiAuto = exports.isAiAutoSuspended = void 0;
const context_1 = require("../context");
const ensure_states_1 = require("../ensure_states");
const strategy_preferences_1 = require("../strategy_preferences");
const ensure_states_2 = require("../compare/ensure_states");
const apply_plan_b_1 = require("./apply_plan_b");
const authority_1 = require("./authority");
const publish_1 = require("./publish");
async function readSlotPreferences(host) {
    try {
        const st = await host.getStateAsync(ensure_states_1.AI_STATES.lastSlotPreferencesJson);
        if (typeof st?.val !== "string" || !st.val)
            return [];
        const parsed = JSON.parse(st.val);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((p) => !!p &&
            typeof p === "object" &&
            typeof p.addonId === "string" &&
            typeof p.slotStartIso === "string" &&
            typeof p.weight === "number");
    }
    catch {
        return [];
    }
}
async function readDecisions(host) {
    try {
        const st = await host.getStateAsync(ensure_states_1.AI_STATES.lastDecisionsJson);
        if (typeof st?.val !== "string" || !st.val)
            return [];
        const parsed = JSON.parse(st.val);
        if (!Array.isArray(parsed))
            return [];
        return parsed.filter((d) => !!d &&
            typeof d === "object" &&
            typeof d.addonId === "string" &&
            typeof d.action === "string" &&
            typeof d.note === "string");
    }
    catch {
        return [];
    }
}
async function writeCompareStates(host, result) {
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.planAChartJson, { val: JSON.stringify(result.chartA), ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.planBChartJson, { val: JSON.stringify(result.chartB), ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.deltaSummaryJson, { val: JSON.stringify(result.delta), ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.activePlan, { val: result.delta.activePlan, ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.generatedAt, { val: result.generatedAt, ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.planRevision, { val: result.planRevision, ack: true });
}
async function isAiAutoSuspended(host) {
    const st = await host.getStateAsync(ensure_states_1.AI_STATES.autoSuspended);
    return st?.val === true;
}
exports.isAiAutoSuspended = isAiAutoSuspended;
async function suspendAiAuto(host, reasonDe) {
    await host.setStateAsync(ensure_states_1.AI_STATES.autoSuspended, { val: true, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.autoSuspendReasonDe, { val: reasonDe.slice(0, 480), ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
}
exports.suspendAiAuto = suspendAiAuto;
async function clearAiAutoSuspend(host) {
    await host.setStateAsync(ensure_states_1.AI_STATES.autoSuspended, { val: false, ack: true });
    await host.setStateAsync(ensure_states_1.AI_STATES.autoSuspendReasonDe, { val: "", ack: true });
}
exports.clearAiAutoSuspend = clearAiAutoSuspend;
/**
 * Nach Daily-Plan-Build: Plan-B-Compare schreiben (advisory).
 * Beta: Allocation wird nie mutiert — Unified bleibt alleinige Planwahrheit.
 */
async function maybeApplyAiWritebackOnDailyPlan(host, plan) {
    const prefs = await readSlotPreferences(host);
    if (prefs.length === 0)
        return plan;
    const decisions = await readDecisions(host);
    const options = {
        wallboxPvOnly: (0, strategy_preferences_1.wallboxPvOnlyFromDecisions)(decisions),
    };
    const allowed = (0, context_1.resolveAllowedAddonIds)(host.config);
    const { plan: next, compare, writebackApplied } = (0, apply_plan_b_1.applyAiPreferencesToDailyPlan)(plan, allowed, prefs, options);
    const advisory = (0, authority_1.buildPlanBAdvisory)(compare);
    compare.delta.decisionReasonDe = advisory.decisionReasonDe;
    await writeCompareStates(host, compare);
    if (!authority_1.AI_ALLOCATION_LIVE_MUTATION_ENABLED) {
        return plan;
    }
    return writebackApplied ? next : plan;
}
exports.maybeApplyAiWritebackOnDailyPlan = maybeApplyAiWritebackOnDailyPlan;
/**
 * Nach einem KI-Lauf: Plan B vergleichen — advisory Compare publizieren.
 * Beta: kein republish mutierter Allocations; Prefs bleiben als Empfehlung erhalten,
 * wenn Plan B bevorzugt wird (für spätere Unified-Replan-Inputs).
 */
async function finalizeAiRunWithWritebackGate(host, plan, slotPreferences, options) {
    const allowed = (0, context_1.resolveAllowedAddonIds)(host.config);
    const { plan: next, compare, writebackApplied } = (0, apply_plan_b_1.applyAiPreferencesToDailyPlan)(plan, allowed, slotPreferences, options);
    const advisory = (0, authority_1.buildPlanBAdvisory)(compare);
    compare.delta.decisionReasonDe = advisory.decisionReasonDe;
    await writeCompareStates(host, compare);
    const planBPreferred = compare.delta.activePlan === "b";
    if (authority_1.AI_ALLOCATION_LIVE_MUTATION_ENABLED && writebackApplied) {
        await clearAiAutoSuspend(host);
        await (0, publish_1.republishDailyPlanAfterWriteback)(host, next);
        return {
            writebackApplied: true,
            planBPreferred: true,
            suspended: false,
            compare,
            advisory,
        };
    }
    if (planBPreferred) {
        // Advisory win: Prefs behalten (späterer Unified-Input), kein Live-Republish.
        await clearAiAutoSuspend(host);
        return {
            writebackApplied: false,
            planBPreferred: true,
            suspended: false,
            compare,
            advisory,
        };
    }
    // Verwaiste Prefs entfernen, damit Daily-Plan-Rebuild nicht stumpf re-appliziert.
    if (slotPreferences.length > 0) {
        await host.setStateAsync(ensure_states_1.AI_STATES.lastSlotPreferencesJson, { val: "[]", ack: true });
    }
    // Auto-suspend nur Legacy: Prefs da, kein Vorteil — nie nur wegen leerem Denken / Thinking-Modus.
    if (slotPreferences.length > 0 && options?.skipAutoSuspend !== true) {
        await suspendAiAuto(host, compare.delta.decisionReasonDe);
        return {
            writebackApplied: false,
            planBPreferred: false,
            suspended: true,
            compare,
            advisory,
        };
    }
    return {
        writebackApplied: false,
        planBPreferred: false,
        suspended: false,
        compare,
        advisory,
    };
}
exports.finalizeAiRunWithWritebackGate = finalizeAiRunWithWritebackGate;
var apply_plan_b_2 = require("./apply_plan_b");
Object.defineProperty(exports, "applyAiPreferencesToDailyPlan", { enumerable: true, get: function () { return apply_plan_b_2.applyAiPreferencesToDailyPlan; } });
var publish_2 = require("./publish");
Object.defineProperty(exports, "republishDailyPlanAfterWriteback", { enumerable: true, get: function () { return publish_2.republishDailyPlanAfterWriteback; } });
var authority_2 = require("./authority");
Object.defineProperty(exports, "AI_ALLOCATION_LIVE_MUTATION_ENABLED", { enumerable: true, get: function () { return authority_2.AI_ALLOCATION_LIVE_MUTATION_ENABLED; } });
Object.defineProperty(exports, "buildPlanBAdvisory", { enumerable: true, get: function () { return authority_2.buildPlanBAdvisory; } });
