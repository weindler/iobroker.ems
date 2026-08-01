"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.republishDailyPlanAfterWriteback = exports.applyAiPreferencesToDailyPlan = exports.finalizeAiRunWithWritebackGate = exports.maybeApplyAiWritebackOnDailyPlan = exports.clearAiAutoSuspend = exports.suspendAiAuto = exports.isAiAutoSuspended = void 0;
const context_1 = require("../context");
const ensure_states_1 = require("../ensure_states");
const strategy_preferences_1 = require("../strategy_preferences");
const ensure_states_2 = require("../compare/ensure_states");
const apply_plan_b_1 = require("./apply_plan_b");
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
 * Nach Daily-Plan-Build: vorhandene KI-Präferenzen auswerten — bei messbarem Plan-B-Vorteil
 * Allocation umschreiben (Write-back), sonst Plan A unverändert.
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
    await writeCompareStates(host, compare);
    return writebackApplied ? next : plan;
}
exports.maybeApplyAiWritebackOnDailyPlan = maybeApplyAiWritebackOnDailyPlan;
/**
 * Nach einem KI-Lauf: Plan B prüfen — gewinnen → Suspend löschen + sofort publish;
 * verlieren → Auto-Trigger sperren und Präferenzen verwerfen.
 * Ohne Slot-Präferenzen (nur Denken/Decisions) → kein Auto-Suspend.
 */
async function finalizeAiRunWithWritebackGate(host, plan, slotPreferences, options) {
    const allowed = (0, context_1.resolveAllowedAddonIds)(host.config);
    const { plan: next, compare, writebackApplied } = (0, apply_plan_b_1.applyAiPreferencesToDailyPlan)(plan, allowed, slotPreferences, options);
    await writeCompareStates(host, compare);
    if (writebackApplied) {
        await clearAiAutoSuspend(host);
        await (0, publish_1.republishDailyPlanAfterWriteback)(host, next);
        return { writebackApplied: true, suspended: false, compare };
    }
    // Auto-suspend nur wenn Präferenzen da sind und Plan B nicht schlägt — nie nur wegen leerem Denken.
    if (slotPreferences.length > 0) {
        await suspendAiAuto(host, compare.delta.decisionReasonDe);
        return { writebackApplied: false, suspended: true, compare };
    }
    return { writebackApplied: false, suspended: false, compare };
}
exports.finalizeAiRunWithWritebackGate = finalizeAiRunWithWritebackGate;
var apply_plan_b_2 = require("./apply_plan_b");
Object.defineProperty(exports, "applyAiPreferencesToDailyPlan", { enumerable: true, get: function () { return apply_plan_b_2.applyAiPreferencesToDailyPlan; } });
var publish_2 = require("./publish");
Object.defineProperty(exports, "republishDailyPlanAfterWriteback", { enumerable: true, get: function () { return publish_2.republishDailyPlanAfterWriteback; } });
