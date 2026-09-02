/**
 * Tibber Grid Rewards braucht EVCC im steuerbaren Schnell-Modus (now).
 * Nach disconnected→connected erst stabilisieren, dann einmal now setzen.
 * Kein pauschales NOW bei normalen PV-/EMS-Ladevorgängen.
 */

export const TIBBER_NOW_STABILIZE_DEFAULT_S = 180;
export const TIBBER_NOW_STABILIZE_MIN_S = 30;
export const TIBBER_NOW_STABILIZE_MAX_S = 900;

export type TibberNowPrepareAction = "idle" | "wait" | "set_now" | "cancel";

export type TibberNowPrepareState = {
	prevConnected: boolean | null;
	connectedSinceMs: number | null;
	prepareIssued: boolean;
};

export function emptyTibberNowPrepareState(): TibberNowPrepareState {
	return { prevConnected: null, connectedSinceMs: null, prepareIssued: false };
}

export function clampTibberNowStabilizeSeconds(raw: number | null | undefined): number {
	if (raw == null || !Number.isFinite(raw)) return TIBBER_NOW_STABILIZE_DEFAULT_S;
	return Math.max(TIBBER_NOW_STABILIZE_MIN_S, Math.min(TIBBER_NOW_STABILIZE_MAX_S, Math.round(raw)));
}

export function evaluateTibberNowPrepare(input: {
	enabled: boolean;
	connected: boolean | null;
	nowMs: number;
	delayMs: number;
	blocked: boolean;
	plannerWantsChargeOrStop: boolean;
	alreadyNow: boolean;
	prev: TibberNowPrepareState;
}): { next: TibberNowPrepareState; action: TibberNowPrepareAction; reason: string } {
	if (!input.enabled) {
		return {
			next: emptyTibberNowPrepareState(),
			action: "idle",
			reason: "tibber_grid_rewards_disabled",
		};
	}
	if (input.connected === false) {
		return {
			next: { prevConnected: false, connectedSinceMs: null, prepareIssued: false },
			action: input.prev.connectedSinceMs != null ? "cancel" : "idle",
			reason: "vehicle_disconnected",
		};
	}
	if (input.connected !== true) {
		return { next: input.prev, action: "idle", reason: "connection_unknown" };
	}

	let next: TibberNowPrepareState = { ...input.prev, prevConnected: true };
	if (input.prev.prevConnected === false) {
		next = { prevConnected: true, connectedSinceMs: input.nowMs, prepareIssued: false };
	} else if (input.prev.prevConnected == null) {
		return {
			next: { prevConnected: true, connectedSinceMs: null, prepareIssued: true },
			action: "idle",
			reason: "already_connected_at_start",
		};
	}

	if (next.connectedSinceMs == null || next.prepareIssued) {
		return { next, action: "idle", reason: next.prepareIssued ? "already_prepared" : "no_plug_edge" };
	}
	if (input.blocked) {
		return { next, action: "wait", reason: "blocked_by_priority" };
	}
	if (input.plannerWantsChargeOrStop) {
		return { next, action: "wait", reason: "planner_has_priority" };
	}
	const elapsed = input.nowMs - next.connectedSinceMs;
	if (elapsed < input.delayMs) {
		return { next, action: "wait", reason: "stabilize_wait" };
	}
	if (input.alreadyNow) {
		return { next: { ...next, prepareIssued: true }, action: "idle", reason: "already_now" };
	}
	return { next: { ...next, prepareIssued: true }, action: "set_now", reason: "tibber_now_after_stabilize" };
}
