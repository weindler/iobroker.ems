import type { PlannerAuthorizationState } from "./types";

const ALLOWED: Record<PlannerAuthorizationState, readonly PlannerAuthorizationState[]> = {
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

export function canTransitionAuthorizationState(
	from: PlannerAuthorizationState,
	to: PlannerAuthorizationState,
): boolean {
	return ALLOWED[from].includes(to);
}

/**
 * Pure transition. Throws on illegal jump (for tests / callers that want strictness).
 */
export function transitionAuthorizationState(
	from: PlannerAuthorizationState,
	to: PlannerAuthorizationState,
): PlannerAuthorizationState {
	if (!canTransitionAuthorizationState(from, to)) {
		throw new Error(`illegal_authorization_transition:${from}->${to}`);
	}
	return to;
}

export function tryTransitionAuthorizationState(
	from: PlannerAuthorizationState,
	to: PlannerAuthorizationState,
): { ok: true; state: PlannerAuthorizationState } | { ok: false; state: PlannerAuthorizationState } {
	if (!canTransitionAuthorizationState(from, to)) {
		return { ok: false, state: from };
	}
	return { ok: true, state: to };
}
