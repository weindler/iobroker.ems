"use strict";
/**
 * Lightweight action bridge — heavy service loaded only on conscious prepare/confirm.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.handlePlannerAuthorizationStateChange = void 0;
const states_1 = require("./states");
function isConsciousButton(val, ack) {
    return val === true && ack !== true;
}
async function handlePlannerAuthorizationStateChange(host, relativeId, val, ack, handlers) {
    if (!(0, states_1.isPlannerAuthorizationState)(relativeId))
        return false;
    if (relativeId === states_1.PLANNER_AUTHORIZATION_STATE_IDS.prepare) {
        if (!isConsciousButton(val, ack))
            return true;
        await host.setStateAsync(relativeId, { val: false, ack: true });
        await handlers.prepare();
        return true;
    }
    if (relativeId === states_1.PLANNER_AUTHORIZATION_STATE_IDS.confirm) {
        if (!isConsciousButton(val, ack))
            return true;
        await host.setStateAsync(relativeId, { val: false, ack: true });
        const id = await handlers.getConfirmChallengeId();
        await handlers.confirm(id);
        await host.setStateAsync(states_1.PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId, { val: "", ack: true });
        return true;
    }
    if (relativeId === states_1.PLANNER_AUTHORIZATION_STATE_IDS.cancel) {
        if (!isConsciousButton(val, ack))
            return true;
        await host.setStateAsync(relativeId, { val: false, ack: true });
        await handlers.cancel();
        await host.setStateAsync(states_1.PLANNER_AUTHORIZATION_STATE_IDS.confirmChallengeId, { val: "", ack: true });
        return true;
    }
    return true;
}
exports.handlePlannerAuthorizationStateChange = handlePlannerAuthorizationStateChange;
