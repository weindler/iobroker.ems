/**
 * Separate:
 * - state validity (value normalizable)
 * - EVCC source freshness (reachable / live telemetry)
 * - command confirmation (mode changed after our write)
 *
 * status.mode.ts is not a source heartbeat. The official iobroker.evcc adapter
 * calls setState on every poll for loadpoint status, but mode may still keep an
 * old ts if a setup uses setStateChanged or MQTT-on-change. Connection ts is
 * only written on connect/disconnect — never use it as a heartbeat.
 */

import {
	EV_FEEDBACK_CLOCK_SKEW_MS,
	EV_SOURCE_STALE_AFTER_MS,
	type EvExecutionMode,
} from "./types";

export interface EvccSourceFreshness {
	fresh: boolean;
	reason: string;
	signal: "connection" | "heartbeat" | "telemetry_valid";
}

export function maxFiniteTs(values: ReadonlyArray<number | null | undefined>): number | null {
	let max: number | null = null;
	for (const v of values) {
		if (v != null && Number.isFinite(v)) {
			if (max == null || v > max) max = v;
		}
	}
	return max;
}

/** Age helper for heartbeat timestamps — not for status.mode.ts. */
export function isEvccHeartbeatStale(input: {
	tsMs: number | null;
	nowMs: number;
	staleAfterMs?: number;
}): boolean {
	if (input.tsMs == null || !Number.isFinite(input.tsMs)) return true;
	const limit = input.staleAfterMs ?? EV_SOURCE_STALE_AFTER_MS;
	return input.nowMs - input.tsMs > limit;
}

/**
 * @deprecated Name kept for Phase 5A tests. This is heartbeat age, not mode.ts.
 */
export function isEvccModeFeedbackStale(input: {
	tsMs: number | null;
	nowMs: number;
	staleAfterMs?: number;
}): boolean {
	return isEvccHeartbeatStale(input);
}

export function evaluateEvccSourceFreshness(input: {
	connectionValue: boolean | null;
	connectionKnown: boolean;
	heartbeatTsMs: number | null;
	heartbeatConfigured: boolean;
	nowMs: number;
	staleAfterMs?: number;
}): EvccSourceFreshness {
	if (input.connectionKnown && input.connectionValue === false) {
		return { fresh: false, reason: "evcc_source_offline", signal: "connection" };
	}

	if (input.heartbeatConfigured && input.heartbeatTsMs != null) {
		if (isEvccHeartbeatStale({ tsMs: input.heartbeatTsMs, nowMs: input.nowMs, staleAfterMs: input.staleAfterMs })) {
			return { fresh: false, reason: "evcc_source_stale", signal: "heartbeat" };
		}
		return { fresh: true, reason: "", signal: "heartbeat" };
	}

	if (input.connectionKnown && input.connectionValue === true) {
		return { fresh: true, reason: "", signal: "connection" };
	}

	/** No connection mapping and no heartbeat: do not invent stale from status.mode.ts. */
	return { fresh: true, reason: "", signal: "telemetry_valid" };
}

/**
 * After a write, matching status.mode is confirmation only if its ts is not older
 * than the command. An unchanged pre-write timestamp is not new feedback.
 * Before a write, actual===desired is handled separately (no write).
 */
export function isCommandFeedbackConfirmed(input: {
	actualMode: EvExecutionMode | null;
	pendingMode: EvExecutionMode;
	lastCommandAtMs: number | null;
	modeTsMs?: number | null;
}): boolean {
	if (input.actualMode !== input.pendingMode) return false;
	if (input.modeTsMs == null || input.lastCommandAtMs == null) return true;
	return input.modeTsMs + EV_FEEDBACK_CLOCK_SKEW_MS >= input.lastCommandAtMs;
}
