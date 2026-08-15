/**
 * Execution authority with a small hysteresis.
 * Reuses Phase-3 raw externalAuthorityState — no second takeover scorer.
 *
 * EMS → External: immediate.
 * External → EMS: only after the last hold signal aged out (no flicker takeover).
 */

import type { EvExternalAuthorityState } from "../types";
import { EV_AUTHORITY_CONFIRM_MS, EV_AUTHORITY_HOLD_MS, type EvExecutionAuthority } from "./types";

export function rawExternalHolds(raw: EvExternalAuthorityState): boolean {
	return raw === "active" || raw === "planned" || raw === "active_without_plan";
}

export function stabilizeExecutionAuthority(input: {
	raw: EvExternalAuthorityState;
	externalExpected: boolean;
	prevAuthority: EvExecutionAuthority;
	lastExternalHoldAtMs: number | null;
	lastInactiveSinceMs: number | null;
	nowMs: number;
}): {
	authority: EvExecutionAuthority;
	lastExternalHoldAtMs: number | null;
	lastInactiveSinceMs: number | null;
	failsafeReason: string;
} {
	if (!input.externalExpected) {
		return {
			authority: "ems",
			lastExternalHoldAtMs: null,
			lastInactiveSinceMs: null,
			failsafeReason: "",
		};
	}

	if (input.raw === "unknown") {
		return {
			authority: "none",
			lastExternalHoldAtMs: input.lastExternalHoldAtMs,
			lastInactiveSinceMs: input.lastInactiveSinceMs,
			failsafeReason: "authority_unknown",
		};
	}
	if (input.raw === "unavailable") {
		return {
			authority: "none",
			lastExternalHoldAtMs: input.lastExternalHoldAtMs,
			lastInactiveSinceMs: input.lastInactiveSinceMs,
			failsafeReason: "external_unavailable",
		};
	}

	if (rawExternalHolds(input.raw)) {
		return {
			authority: "external",
			lastExternalHoldAtMs: input.nowMs,
			lastInactiveSinceMs: null,
			failsafeReason: "",
		};
	}

	/** inactive */
	const holdAt = input.lastExternalHoldAtMs;
	const inactiveSince = input.lastInactiveSinceMs ?? input.nowMs;
	if (holdAt != null && input.nowMs - holdAt < EV_AUTHORITY_HOLD_MS) {
		return {
			authority: "external",
			lastExternalHoldAtMs: holdAt,
			lastInactiveSinceMs: inactiveSince,
			failsafeReason: "",
		};
	}
	if (holdAt != null && input.nowMs - inactiveSince < EV_AUTHORITY_CONFIRM_MS) {
		return {
			authority: "external",
			lastExternalHoldAtMs: holdAt,
			lastInactiveSinceMs: inactiveSince,
			failsafeReason: "",
		};
	}
	if (holdAt == null) {
		/** Never observed an external hold this session — EMS may run. */
		return {
			authority: "ems",
			lastExternalHoldAtMs: null,
			lastInactiveSinceMs: inactiveSince,
			failsafeReason: "",
		};
	}
	return {
		authority: "ems",
		lastExternalHoldAtMs: holdAt,
		lastInactiveSinceMs: inactiveSince,
		failsafeReason: "",
	};
}
