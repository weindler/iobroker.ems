/**
 * Phase 5B controlled live test — one productive EVCC button command.
 * EV_EXECUTION_PHASE5_ENABLED stays false (no Dauerbetrieb).
 * Arming is in-memory; a persisted true is never reconstructed after restart.
 */

import type { EvExecutionDesired, EvExecutionMode } from "./types";

export interface EvLiveTestState {
	armed: boolean;
	consumed: boolean;
	armedAtMs: number | null;
	consumedAtMs: number | null;
	command: EvExecutionMode | null;
	result: string;
	blockReason: string;
	retriesBlocked: boolean;
}

export function emptyEvLiveTestState(): EvLiveTestState {
	return {
		armed: false,
		consumed: false,
		armedAtMs: null,
		consumedAtMs: null,
		command: null,
		result: "",
		blockReason: "",
		retriesBlocked: false,
	};
}

export function armEvLiveTest(nowMs: number): EvLiveTestState {
	return {
		armed: true,
		consumed: false,
		armedAtMs: nowMs,
		consumedAtMs: null,
		command: null,
		result: "armed",
		blockReason: "",
		retriesBlocked: false,
	};
}

export function disarmEvLiveTest(prev: EvLiveTestState): EvLiveTestState {
	if (prev.consumed) {
		return {
			...prev,
			armed: false,
			retriesBlocked: true,
			result: "disarmed_after_pulse",
			blockReason: "live_test_disarmed",
		};
	}
	return {
		...emptyEvLiveTestState(),
		result: "disarmed",
		blockReason: "",
	};
}

export function consumeEvLiveTest(
	prev: EvLiveTestState,
	command: EvExecutionMode,
	nowMs: number,
): EvLiveTestState {
	return {
		...prev,
		armed: false,
		consumed: true,
		consumedAtMs: nowMs,
		command,
		result: "consumed",
		blockReason: "",
		retriesBlocked: false,
	};
}

export function markEvLiveTestResult(prev: EvLiveTestState, result: string): EvLiveTestState {
	if (!prev.consumed) return prev;
	return { ...prev, result };
}

export function evaluateEvLiveTestPermit(input: {
	liveTest: EvLiveTestState;
	desiredMode: EvExecutionDesired | null;
	pendingMode?: EvExecutionMode | null;
	pendingActive?: boolean;
}): { permit: boolean; blockReason: string; consumeOnSuccessfulWrite: boolean } {
	const desired = input.desiredMode;
	const wantsWrite = desired != null && desired !== "noop";
	const t = input.liveTest;

	if (t.retriesBlocked) {
		return { permit: false, blockReason: "live_test_disarmed", consumeOnSuccessfulWrite: false };
	}

	if (t.consumed) {
		const samePendingRetry =
			wantsWrite &&
			desired === t.command &&
			input.pendingActive === true &&
			input.pendingMode === t.command;
		if (samePendingRetry) {
			return { permit: true, blockReason: "", consumeOnSuccessfulWrite: false };
		}
		return { permit: false, blockReason: "live_test_consumed", consumeOnSuccessfulWrite: false };
	}

	if (!t.armed) {
		return { permit: false, blockReason: "live_test_not_armed", consumeOnSuccessfulWrite: false };
	}

	if (!wantsWrite) {
		return { permit: false, blockReason: "", consumeOnSuccessfulWrite: false };
	}

	return { permit: true, blockReason: "", consumeOnSuccessfulWrite: true };
}

export function applyEvLiveTestOperatorInputs(input: {
	prev: EvLiveTestState;
	armedVal: unknown;
	armedAck: boolean | undefined;
	disarmVal: unknown;
	nowMs: number;
}): EvLiveTestState {
	let next = input.prev;
	if (input.armedVal === true && input.armedAck === false) {
		next = armEvLiveTest(input.nowMs);
	} else if (input.armedVal === false && input.armedAck === false) {
		next = disarmEvLiveTest(next);
	}
	if (input.disarmVal === true) {
		next = disarmEvLiveTest(next);
	}
	return next;
}
