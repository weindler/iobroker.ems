"use strict";
/**
 * Phase-4 EV planner diagnosis → wallbox.ev_foundation states.
 * Planning-only. No EVCC / Tibber / Sonnen / Ford / go-e writes.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishEvPlannerDiagnosis = void 0;
const ensure_states_1 = require("../../../addons/wallbox/ev_foundation/ensure_states");
const state_write_1 = require("../../../policy/core/state_write");
async function publishEvPlannerDiagnosis(host, diag) {
    const d = diag ?? null;
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannerParticipating, d?.participating === true);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannerRole, d?.role ?? "electric_vehicle");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evManagementMode, d?.managementMode ?? "unavailable");
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evHardEnergyKwh, d?.hardEnergyKwh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evTargetEnergyKwh, d?.targetEnergyKwh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evAcEnergyRequiredKwh, d?.acEnergyRequiredKwh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannedEnergyKwh, d?.plannedEnergyKwh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evUnplannedEnergyKwh, d?.unplannedEnergyKwh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannedCostEur, d?.plannedCostEur ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannedPvEnergyKwh, d?.plannedPvEnergyKwh ?? null);
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannedGridEnergyKwh, d?.plannedGridEnergyKwh ?? null);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannedFirstStart, d?.plannedFirstStart ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlannedLastEnd, d?.plannedLastEnd ?? "");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlanQuality, d?.planQuality ?? "unknown");
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.evPlanJson, d ? JSON.stringify({ ...d.explain, managementMode: d.managementMode, plannedEnergyKwh: d.plannedEnergyKwh }) : "{}");
}
exports.publishEvPlannerDiagnosis = publishEvPlannerDiagnosis;
