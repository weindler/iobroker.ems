"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.publishEvFoundationDiagnosis = void 0;
const state_write_1 = require("../../../policy/core/state_write");
const ensure_states_1 = require("./ensure_states");
const types_1 = require("./external/types");
async function publishEvFoundationDiagnosis(host, model, _capabilities, _observedAt, external, decision) {
    const plan = external?.smartPlan ?? (0, types_1.emptySmartPlanEval)();
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalSmartPlanJson, JSON.stringify(plan.slots));
    await (0, state_write_1.setOptionalNumberIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalMinSocPct, model.externalSmartChargingMinSocPct);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.externalAuthorityState, decision?.externalAuthorityState ?? model.externalAuthorityState);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.takeoverSeverity, decision?.takeoverSeverity ?? model.takeoverSeverity);
    await (0, state_write_1.setStateIfChanged)(host, ensure_states_1.WALLBOX_EV_FOUNDATION_STATES.preparedEvState, model.preparedEvState);
}
exports.publishEvFoundationDiagnosis = publishEvFoundationDiagnosis;
