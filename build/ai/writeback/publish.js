"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.republishDailyPlanAfterWriteback = void 0;
const state_write_1 = require("../../policy/core/state_write");
const addon_plan_publish_1 = require("../../operator/daily_plan/addon_plan_publish");
const states_1 = require("../../operator/daily_plan/states");
function asStateHost(host) {
    return host;
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
        // IH/AC: nicht hier publizieren — autoritativ erst nach Unified-Merge im Daily-Plan-Tick.
        const addonSummaries = [
            { key: "battery", prefix: "battery" },
            { key: "wallbox", prefix: "wallbox" },
        ];
        for (const { key, prefix } of addonSummaries) {
            const ids = states_1.ALLOCATION_ADDON_STATE_IDS[key];
            const view = (0, addon_plan_publish_1.addonAllocationPublishView)(plan, prefix, { kiWriteback: true });
            await (0, state_write_1.setStateIfChanged)(h, ids.status, view.status);
            await (0, state_write_1.setStateIfChanged)(h, ids.planJson, JSON.stringify(view.runnable));
            await (0, state_write_1.setStateIfChanged)(h, ids.reasonDe, view.reasonDe);
        }
    }
    catch (e) {
        host.log?.warn?.(`KI Write-back publish: ${String(e)}`);
    }
}
exports.republishDailyPlanAfterWriteback = republishDailyPlanAfterWriteback;
