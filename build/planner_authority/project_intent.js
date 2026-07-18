"use strict";
/**
 * Compact projector: writes the worker-dryrun authoritative view's slot allocations
 * into the existing intent allocation states so device runtimes keep working without
 * reading candidates directly.
 *
 * Fidelity note: candidate allocations are compact (power/energy/status only). Energy
 * source split (grid vs pv) is not carried, so projected entries default to a
 * conservative pv-surplus attribution. Grid-charging intent is intentionally NOT
 * fabricated from a worker candidate.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectWorkerViewToIntentStates = void 0;
const state_write_1 = require("../policy/core/state_write");
const states_1 = require("../operator/daily_plan/states");
const time_1 = require("../operator/time");
const ADDON_PREFIXES = [
    { prefix: "battery.", addon: "battery" },
    { prefix: "wallbox.", addon: "wallbox" },
    { prefix: "immersion_heater.", addon: "immersion_heater" },
    { prefix: "air_conditioning.", addon: "air_conditioning" },
];
function addonForContribution(contributionId) {
    for (const { prefix, addon } of ADDON_PREFIXES) {
        if (contributionId.startsWith(prefix))
            return addon;
    }
    return null;
}
function projectSlot(slot, byAddon) {
    for (const a of slot.allocations) {
        const addon = addonForContribution(a.contributionId);
        if (!addon)
            continue;
        const list = byAddon.get(addon) ?? [];
        list.push({
            contributionId: a.contributionId,
            slot: { startIso: slot.slotStart, endIso: slot.slotEnd },
            status: a.status,
            powerW: a.powerW,
            energyKwh: a.energyKwh,
            energySource: "pv_surplus",
        });
        byAddon.set(addon, list);
    }
}
/**
 * Project the current + next slot allocations of a worker-dryrun view into the
 * existing allocation + daily plan meta states. No-op if the view is not a usable
 * worker view.
 */
async function projectWorkerViewToIntentStates(host, input) {
    const { view } = input;
    if (view.source !== "worker_dryrun")
        return;
    if (view.quality !== "valid" || !view.currentSlot)
        return;
    const byAddon = new Map();
    projectSlot(view.currentSlot, byAddon);
    if (view.nextSlot)
        projectSlot(view.nextSlot, byAddon);
    for (const addon of Object.keys(states_1.ALLOCATION_ADDON_STATE_IDS)) {
        const entries = byAddon.get(addon) ?? [];
        const ids = states_1.ALLOCATION_ADDON_STATE_IDS[addon];
        await (0, state_write_1.setStateIfChanged)(host, ids.planJson, JSON.stringify(entries));
        await (0, state_write_1.setStateIfChanged)(host, ids.status, entries.length > 0 ? "ready" : "not_initialized");
        await (0, state_write_1.setStateIfChanged)(host, ids.reasonDe, "Worker-Dryrun-Projektion (kompakt).");
    }
    const localDate = (0, time_1.localDateKeyInTimezone)(input.now, input.timezone);
    const validUntil = view.nextSlot?.slotEnd ?? view.currentSlot.slotEnd;
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.status, "ready");
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.date, localDate);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.globalMode, input.globalMode);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.slotMinutes, input.slotMinutes ?? 15);
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.generatedAt, input.now.toISOString());
    await (0, state_write_1.setStateIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.validUntil, validUntil);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, states_1.DAILY_PLAN_STATE_IDS.revision, view.generation ?? 0);
}
exports.projectWorkerViewToIntentStates = projectWorkerViewToIntentStates;
