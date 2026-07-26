"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.republishDailyPlanAfterWriteback = void 0;
const state_write_1 = require("../../policy/core/state_write");
const states_1 = require("../../operator/daily_plan/states");
function asStateHost(host) {
    return host;
}
function addonAllocationSummary(plan, addonPrefix) {
    if (addonPrefix === "air_conditioning") {
        return plan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
    }
    return plan.allocations.filter((a) => a.contributionId === addonPrefix ||
        a.contributionId.startsWith(`${addonPrefix}.`) ||
        (a.contributor.id === addonPrefix && addonPrefix !== "air_conditioning"));
}
/** Schreibt Daily-Plan- + Allocation-States nach KI-Write-back (Plan B) neu. */
async function republishDailyPlanAfterWriteback(host, plan) {
    const h = asStateHost(host);
    try {
        await (0, state_write_1.setStateIfChanged)(h, states_1.DAILY_PLAN_STATE_IDS.status, plan.status);
        await (0, state_write_1.setStateIfChanged)(h, states_1.DAILY_PLAN_STATE_IDS.reasonDe, plan.reasonDe);
        await (0, state_write_1.setStateIfChanged)(h, states_1.DAILY_PLAN_STATE_IDS.slotsJson, JSON.stringify(plan.slots));
        await (0, state_write_1.setStateIfChanged)(h, states_1.DAILY_PLAN_STATE_IDS.allocationsJson, JSON.stringify(plan.allocations));
        await (0, state_write_1.setStateIfChanged)(h, states_1.DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
        await (0, state_write_1.setOptionalNumberIfChanged)(h, states_1.DAILY_PLAN_STATE_IDS.revision, plan.revision);
        const addonSummaries = [
            { key: "battery", prefix: "battery" },
            { key: "wallbox", prefix: "wallbox" },
            { key: "immersion_heater", prefix: "immersion_heater" },
            { key: "air_conditioning", prefix: "air_conditioning" },
        ];
        for (const { key, prefix } of addonSummaries) {
            const ids = states_1.ALLOCATION_ADDON_STATE_IDS[key];
            const summary = addonAllocationSummary(plan, prefix);
            await (0, state_write_1.setStateIfChanged)(h, ids.status, summary.length > 0 ? "ready" : "idle");
            await (0, state_write_1.setStateIfChanged)(h, ids.planJson, JSON.stringify(summary));
            await (0, state_write_1.setStateIfChanged)(h, ids.reasonDe, summary.length > 0
                ? `${summary.length} Allocation-Einträge für ${prefix} (ggf. KI Plan B).`
                : `Keine Allocation für ${prefix}.`);
        }
    }
    catch (e) {
        host.log?.warn?.(`KI Write-back publish: ${String(e)}`);
    }
}
exports.republishDailyPlanAfterWriteback = republishDailyPlanAfterWriteback;
