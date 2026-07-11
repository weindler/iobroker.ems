"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ensureDailyPlanStates = exports.ALLOCATION_ADDON_STATE_IDS = exports.DAILY_PLAN_STATE_IDS = void 0;
const state_util_1 = require("../../ems_light/state_util");
function strState(id, name, def) {
    return {
        id,
        common: { name, type: "string", role: "text", read: true, write: false, def },
        defaultVal: def,
        setDefaultIfEmpty: true,
    };
}
function numState(id, name, def) {
    return {
        id,
        common: { name, type: "number", role: "value", read: true, write: false, def },
        defaultVal: def,
    };
}
exports.DAILY_PLAN_STATE_IDS = {
    status: "planner.intent.daily_plan.status",
    generatedAt: "planner.intent.daily_plan.generated_at",
    validUntil: "planner.intent.daily_plan.valid_until",
    date: "planner.intent.daily_plan.date",
    globalMode: "planner.intent.daily_plan.global_mode",
    slotMinutes: "planner.intent.daily_plan.slot_minutes",
    activeContributionsJson: "planner.intent.daily_plan.active_contributions_json",
    excludedContributionsJson: "planner.intent.daily_plan.excluded_contributions_json",
    slotsJson: "planner.intent.daily_plan.slots_json",
    allocationsJson: "planner.intent.daily_plan.allocations_json",
    totalsJson: "planner.intent.daily_plan.totals_json",
    unallocatedJson: "planner.intent.daily_plan.unallocated_json",
    policySnapshotJson: "planner.intent.daily_plan.policy_snapshot_json",
    constraintSnapshotJson: "planner.intent.daily_plan.constraint_snapshot_json",
    planJson: "planner.intent.daily_plan.plan_json",
    reasonDe: "planner.intent.daily_plan.reason_de",
    revision: "planner.intent.daily_plan.revision",
};
exports.ALLOCATION_ADDON_STATE_IDS = {
    battery: {
        status: "planner.intent.allocation.battery.status",
        planJson: "planner.intent.allocation.battery.plan_json",
        reasonDe: "planner.intent.allocation.battery.reason_de",
    },
    wallbox: {
        status: "planner.intent.allocation.wallbox.status",
        planJson: "planner.intent.allocation.wallbox.plan_json",
        reasonDe: "planner.intent.allocation.wallbox.reason_de",
    },
    immersion_heater: {
        status: "planner.intent.allocation.immersion_heater.status",
        planJson: "planner.intent.allocation.immersion_heater.plan_json",
        reasonDe: "planner.intent.allocation.immersion_heater.reason_de",
    },
    air_conditioning: {
        status: "planner.intent.allocation.air_conditioning.status",
        planJson: "planner.intent.allocation.air_conditioning.plan_json",
        reasonDe: "planner.intent.allocation.air_conditioning.reason_de",
    },
};
async function ensureDailyPlanStates(host) {
    await (0, state_util_1.ensureChannel)(host, "planner.intent.daily_plan", "Planner Daily Plan");
    const defs = [
        strState(exports.DAILY_PLAN_STATE_IDS.status, "Daily Plan Status", "not_initialized"),
        strState(exports.DAILY_PLAN_STATE_IDS.generatedAt, "Daily Plan erzeugt (ISO)"),
        strState(exports.DAILY_PLAN_STATE_IDS.validUntil, "Daily Plan gültig bis (ISO)"),
        strState(exports.DAILY_PLAN_STATE_IDS.date, "Daily Plan Datum"),
        strState(exports.DAILY_PLAN_STATE_IDS.globalMode, "Daily Plan Global Mode"),
        numState(exports.DAILY_PLAN_STATE_IDS.slotMinutes, "Daily Plan Slot-Minuten", 15),
        strState(exports.DAILY_PLAN_STATE_IDS.activeContributionsJson, "Daily Plan aktive Contributions (JSON)", "[]"),
        strState(exports.DAILY_PLAN_STATE_IDS.excludedContributionsJson, "Daily Plan ausgeschlossene Contributions (JSON)", "[]"),
        strState(exports.DAILY_PLAN_STATE_IDS.slotsJson, "Daily Plan Slots (JSON)", "[]"),
        strState(exports.DAILY_PLAN_STATE_IDS.allocationsJson, "Daily Plan Allocations (JSON)", "[]"),
        strState(exports.DAILY_PLAN_STATE_IDS.totalsJson, "Daily Plan Totals (JSON)", "{}"),
        strState(exports.DAILY_PLAN_STATE_IDS.unallocatedJson, "Daily Plan unalloziert (JSON)", "[]"),
        strState(exports.DAILY_PLAN_STATE_IDS.policySnapshotJson, "Daily Plan Policy Snapshot (JSON)", "{}"),
        strState(exports.DAILY_PLAN_STATE_IDS.constraintSnapshotJson, "Daily Plan Constraint Snapshot (JSON)", "{}"),
        strState(exports.DAILY_PLAN_STATE_IDS.planJson, "Daily Plan vollständig (JSON)", "{}"),
        strState(exports.DAILY_PLAN_STATE_IDS.reasonDe, "Daily Plan Begründung (DE)", ""),
        numState(exports.DAILY_PLAN_STATE_IDS.revision, "Daily Plan Revision", 0),
    ];
    await (0, state_util_1.ensureStates)(host, defs);
    await (0, state_util_1.ensureChannel)(host, "planner.intent.allocation", "Planner Allocation");
    const allocDefs = [];
    for (const [addon, ids] of Object.entries(exports.ALLOCATION_ADDON_STATE_IDS)) {
        allocDefs.push(strState(ids.status, `Allocation ${addon} Status`, "not_initialized"), strState(ids.planJson, `Allocation ${addon} Plan (JSON)`, "{}"), strState(ids.reasonDe, `Allocation ${addon} Begründung (DE)`, ""));
    }
    await (0, state_util_1.ensureStates)(host, allocDefs);
}
exports.ensureDailyPlanStates = ensureDailyPlanStates;
