"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.tryTransitionAuthorizationState = exports.transitionAuthorizationState = exports.canTransitionAuthorizationState = void 0;
const ALLOWED = {
    disabled: ["idle", "disabled"],
    idle: ["ineligible", "prepared", "disabled", "idle", "cancelled"],
    ineligible: ["idle", "prepared", "disabled", "ineligible", "cancelled"],
    prepared: ["confirmed", "cancelled", "expired", "invalidated", "disabled", "prepared"],
    confirmed: ["activation_blocked", "expired", "invalidated", "cancelled", "disabled", "confirmed"],
    activation_blocked: ["expired", "invalidated", "cancelled", "idle", "disabled", "activation_blocked"],
    expired: ["idle", "disabled", "expired"],
    cancelled: ["idle", "disabled", "cancelled"],
    invalidated: ["idle", "disabled", "invalidated"],
    error: ["idle", "disabled", "error"],
};
function canTransitionAuthorizationState(from, to) {
    return ALLOWED[from].includes(to);
}
exports.canTransitionAuthorizationState = canTransitionAuthorizationState;
/**
 * Pure transition. Throws on illegal jump (for tests / callers that want strictness).
 */
function transitionAuthorizationState(from, to) {
    if (!canTransitionAuthorizationState(from, to)) {
        throw new Error(`illegal_authorization_transition:${from}->${to}`);
    }
    return to;
}
exports.transitionAuthorizationState = transitionAuthorizationState;
function tryTransitionAuthorizationState(from, to) {
    if (!canTransitionAuthorizationState(from, to)) {
        return { ok: false, state: from };
    }
    return { ok: true, state: to };
}
exports.tryTransitionAuthorizationState = tryTransitionAuthorizationState;
