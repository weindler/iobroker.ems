"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPlanCompare = void 0;
const context_1 = require("../context");
const ensure_states_1 = require("../ensure_states");
const build_1 = require("./build");
const ensure_states_2 = require("./ensure_states");
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
/**
 * Berechnet den Plan-Vergleich (Plan A vs. KI-gewichtete Plan-B-Simulation für Heizstab/Klima) und
 * schreibt die compare.*-States. Reine Beobachtung — ändert nie den tatsächlich ausgeführten Plan A.
 */
async function runPlanCompare(host, plan) {
    const allowedAddonIds = (0, context_1.resolveAllowedAddonIds)(host.config);
    const slotPreferences = await readSlotPreferences(host);
    const result = (0, build_1.buildCompareResult)(plan, allowedAddonIds, slotPreferences);
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.planAChartJson, { val: JSON.stringify(result.chartA), ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.planBChartJson, { val: JSON.stringify(result.chartB), ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.deltaSummaryJson, { val: JSON.stringify(result.delta), ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.activePlan, { val: result.delta.activePlan, ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.generatedAt, { val: result.generatedAt, ack: true });
    await host.setStateAsync(ensure_states_2.COMPARE_STATES.planRevision, { val: result.planRevision, ack: true });
    return result;
}
exports.runPlanCompare = runPlanCompare;
