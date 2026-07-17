"use strict";
/**
 * Lightweight authority action bridge — service loaded only on conscious activate.
 * Primary button IDs live under planner.authority.*; the planner.takeover.* aliases
 * are accepted for compatibility and map to the same handlers.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlannerAuthorityStateChange = exports.isPlannerAuthorityActionState = void 0;
const states_1 = require("./states");
const ALIAS_ACTIVATE = "planner.takeover.activate_worker_dryrun";
const ALIAS_DEACTIVATE = "planner.takeover.deactivate_worker";
function isConsciousButton(val, ack) {
    return val === true && ack !== true;
}
function isPlannerAuthorityActionState(relativeId) {
    return ((0, states_1.isPlannerAuthorityState)(relativeId) ||
        relativeId === ALIAS_ACTIVATE ||
        relativeId === ALIAS_DEACTIVATE);
}
exports.isPlannerAuthorityActionState = isPlannerAuthorityActionState;
async function handlePlannerAuthorityStateChange(host, relativeId, val, ack, handlers) {
    if (!isPlannerAuthorityActionState(relativeId))
        return false;
    const isActivate = relativeId === states_1.PLANNER_AUTHORITY_STATE_IDS.activateWorkerDryrun || relativeId === ALIAS_ACTIVATE;
    const isDeactivate = relativeId === states_1.PLANNER_AUTHORITY_STATE_IDS.deactivateWorker || relativeId === ALIAS_DEACTIVATE;
    if (isActivate) {
        if (!isConsciousButton(val, ack))
            return true;
        await host.setStateAsync(relativeId, { val: false, ack: true });
        await handlers.activateWorkerDryrun();
        return true;
    }
    if (isDeactivate) {
        if (!isConsciousButton(val, ack))
            return true;
        await host.setStateAsync(relativeId, { val: false, ack: true });
        await handlers.deactivateWorker();
        return true;
    }
    return true;
}
exports.handlePlannerAuthorityStateChange = handlePlannerAuthorityStateChange;
