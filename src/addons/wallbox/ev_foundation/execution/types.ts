/**
 * Phase 5A EV execution types — no economic scoring.
 * Unified already decided; this layer only executes when allowed.
 */

import type { EvccFeedbackModeValue, EvccModeButton } from "../../evcc_mode_control";

export const EV_EXECUTION_AUTHORITIES = ["external", "ems", "none"] as const;
export type EvExecutionAuthority = (typeof EV_EXECUTION_AUTHORITIES)[number];

export const EV_EXECUTION_PHASES = [
	"idle",
	"command_sent",
	"awaiting_feedback",
	"confirmed",
	"retry",
	"failsafe",
] as const;
export type EvExecutionPhase = (typeof EV_EXECUTION_PHASES)[number];

export type EvExecutionMode = EvccFeedbackModeValue;
/** Button modes plus mechanical no-write. Never an EVCC button. */
export type EvExecutionDesired = EvExecutionMode | "noop";
export type EvExecutionButton = EvccModeButton;

/** In-memory only — never reconstructed from ioBroker after restart. */
export const EV_EXECUTION_OWNERSHIPS = ["ems", "none", "unknown"] as const;
export type EvExecutionOwnership = (typeof EV_EXECUTION_OWNERSHIPS)[number];

/** Stay external this long after the last active/planned/active_without_plan signal. */
export const EV_AUTHORITY_HOLD_MS = 5 * 60_000;
/** Require this long of continuous inactive before External → EMS. */
export const EV_AUTHORITY_CONFIRM_MS = 5 * 60_000;
/**
 * Source-heartbeat age (chargePower/charging/connected/offeredCurrent), not status.mode.ts.
 * status.mode may keep an old ts while the value stays valid.
 */
export const EV_SOURCE_STALE_AFTER_MS = 10 * 60_000;
/** @deprecated Use EV_SOURCE_STALE_AFTER_MS — not a status.mode.ts limit. */
export const EV_MODE_STALE_AFTER_MS = EV_SOURCE_STALE_AFTER_MS;
/** Allow ioBroker ts to lag the local write clock slightly. */
export const EV_FEEDBACK_CLOCK_SKEW_MS = 2_000;
/** Do not re-press the button during settle. */
export const EV_FEEDBACK_SETTLE_MS = 15_000;
/** Feedback window after a write (incl. settle). */
export const EV_FEEDBACK_TIMEOUT_MS = 90_000;
/** Minimum gap between retry writes. */
export const EV_RETRY_MIN_INTERVAL_MS = 30_000;
/** Extra writes after the first command (first + 2 retries = 3 pulses max). */
export const EV_MAX_RETRIES = 2;

export interface EvExecutionSession {
	phase: EvExecutionPhase;
	authority: EvExecutionAuthority;
	lastExternalHoldAtMs: number | null;
	lastInactiveSinceMs: number | null;
	pendingMode: EvExecutionMode | null;
	pendingSinceMs: number | null;
	lastCommand: EvExecutionMode | null;
	lastCommandAtMs: number | null;
	lastFeedbackAtMs: number | null;
	lastConfirmedMode: EvExecutionMode | null;
	retryCount: number;
	lastResult: string;
	failsafeReason: string;
	blockReason: string;
	desiredReason: string;
	sourceFresh: boolean;
	ownership: EvExecutionOwnership;
	ownedMode: EvExecutionMode | null;
	ownedSinceMs: number | null;
	releaseReason: string;
	explain: string;
}

export function emptyEvExecutionSession(): EvExecutionSession {
	return {
		phase: "idle",
		authority: "none",
		lastExternalHoldAtMs: null,
		lastInactiveSinceMs: null,
		pendingMode: null,
		pendingSinceMs: null,
		lastCommand: null,
		lastCommandAtMs: null,
		lastFeedbackAtMs: null,
		lastConfirmedMode: null,
		retryCount: 0,
		lastResult: "idle",
		failsafeReason: "",
		blockReason: "",
		desiredReason: "",
		sourceFresh: false,
		ownership: "unknown",
		ownedMode: null,
		ownedSinceMs: null,
		releaseReason: "",
		explain: "",
	};
}

export function clearPending(session: EvExecutionSession): EvExecutionSession {
	return {
		...session,
		pendingMode: null,
		pendingSinceMs: null,
	};
}
