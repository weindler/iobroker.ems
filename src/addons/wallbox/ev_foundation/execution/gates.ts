/**
 * Write gates for Phase 5A/5B. Fail-safe = write lock, never auto-OFF.
 * Source freshness is not status.mode.ts.
 */

import { EV_EXECUTION_PHASE5_ENABLED } from "../write_allowlist";
import type { EvccModeControlVariant } from "../../evcc_mode_control";
import type { EvExecutionAction } from "./ownership";
import { ownershipLabel } from "./ownership";
import type { EvExecutionAuthority, EvExecutionDesired, EvExecutionMode, EvExecutionOwnership } from "./types";

export interface EvExecutionGateInput {
	featureEnabled: boolean;
	globalLive: boolean;
	addonLive: boolean;
	addonEnabled: boolean;
	governanceEnabled: boolean;
	authority: EvExecutionAuthority;
	authorityFailsafeReason: string;
	buttonsReady: boolean;
	resolvedVariant: EvccModeControlVariant;
	desiredMode: EvExecutionDesired | null;
	actualMissing: boolean;
	actualInvalid: boolean;
	sourceStale: boolean;
	sourceOffline: boolean;
	faultActive: boolean;
	restoreInProgress: boolean;
	/** Phase 5B one-shot permit. Never a substitute for governance. */
	liveTestPermit?: boolean;
	liveTestBlockReason?: string;
}

export interface EvExecutionGateResult {
	featureEnabled: boolean;
	writeAllowed: boolean;
	ready: boolean;
	blockReason: string;
	failsafeReason: string;
}

function desiredWantsWrite(desired: EvExecutionDesired | null): desired is EvExecutionMode {
	return desired != null && desired !== "noop";
}

export function evaluateEvExecutionGates(input: EvExecutionGateInput): EvExecutionGateResult {
	const featureEnabled = input.featureEnabled && EV_EXECUTION_PHASE5_ENABLED;
	const executionReleased = featureEnabled || input.liveTestPermit === true;
	let failsafeReason = "";
	let blockReason = "";
	const wantsWrite = desiredWantsWrite(input.desiredMode);

	if (input.desiredMode !== "noop") {
		if (input.authorityFailsafeReason) {
			failsafeReason = input.authorityFailsafeReason;
		} else if (input.authority === "none") {
			failsafeReason = "authority_unknown";
		} else if (input.sourceOffline) {
			failsafeReason = "evcc_source_offline";
		} else if (input.sourceStale) {
			failsafeReason = "evcc_source_stale";
		} else if (input.actualMissing) {
			failsafeReason = "status_mode_missing";
		} else if (input.actualInvalid) {
			failsafeReason = "status_mode_invalid";
		} else if (input.resolvedVariant !== "buttons" || !input.buttonsReady) {
			failsafeReason = "button_contract_unavailable";
		} else if (input.desiredMode == null) {
			failsafeReason = "desired_unmappable";
		}
	}

	if (input.restoreInProgress) blockReason = "restore_in_progress";
	else if (!input.addonEnabled) blockReason = "addon_disabled";
	else if (!input.governanceEnabled) blockReason = "governance";
	else if (input.authority === "external") blockReason = "external_authority";
	else if (!input.globalLive) blockReason = "global_dryrun";
	else if (!input.addonLive) blockReason = "addon_dryrun";
	else if (!executionReleased) {
		blockReason = input.liveTestBlockReason || "feature_gate";
	} else if (input.faultActive) blockReason = "fault_lockout";
	else if (input.sourceOffline && wantsWrite) blockReason = "evcc_source_offline";
	else if (input.sourceStale && wantsWrite) blockReason = "evcc_source_stale";

	const ready =
		input.addonEnabled &&
		input.governanceEnabled &&
		input.authority === "ems" &&
		input.buttonsReady &&
		input.resolvedVariant === "buttons" &&
		!failsafeReason &&
		!input.faultActive &&
		!input.restoreInProgress;

	const writeAllowed =
		ready && executionReleased && input.globalLive && input.addonLive && !blockReason && wantsWrite;
	return {
		featureEnabled,
		writeAllowed,
		ready,
		blockReason,
		failsafeReason,
	};
}

export function formatEvExecutionExplain(input: {
	desired: EvExecutionDesired | null;
	actual: EvExecutionMode | null;
	authority: EvExecutionAuthority;
	phase: string;
	blockReason: string;
	failsafeReason: string;
	writeAllowed: boolean;
	desiredReason?: string;
	sourceFresh?: boolean;
	ownership?: EvExecutionOwnership;
	ownedMode?: EvExecutionMode | null;
	releaseReason?: string;
	action?: EvExecutionAction;
	liveTestArmed?: boolean;
	liveTestConsumed?: boolean;
	liveTestCommand?: EvExecutionMode | null;
	liveTestResult?: string;
	lastResult?: string;
}): string {
	const desired = input.desired ?? "none";
	const actual = input.actual ?? "none";
	const reason = input.desiredReason ?? "";
	const ownership = input.ownership;
	const owned = input.ownedMode ?? null;
	const liveCmd = input.liveTestCommand ?? "none";

	if (input.liveTestConsumed) {
		if (input.phase === "awaiting_feedback" || input.phase === "command_sent" || input.phase === "retry") {
			return `live_test=consumed, command=${liveCmd}, awaiting_feedback`;
		}
		if (input.phase === "confirmed" && input.actual === input.desired) {
			return `live_test=consumed, command=${liveCmd}, feedback=confirmed`;
		}
		if (input.failsafeReason || input.phase === "failsafe") {
			return `live_test=consumed, command=${liveCmd}, feedback=failed`;
		}
		return `live_test=consumed, command=${liveCmd}, ${input.liveTestResult || input.phase}`;
	}
	if (input.liveTestArmed) {
		if (input.authority === "external") {
			return "live_test=armed, authority=external, blocked";
		}
		if (desired === "noop") {
			return "live_test=armed, desired=noop, no_command_sent";
		}
		if (input.lastResult === "already_confirmed" || (input.phase === "confirmed" && input.actual === input.desired)) {
			return `live_test=armed, desired=${desired}, already_confirmed`;
		}
		if (input.blockReason && !input.writeAllowed) {
			return `live_test=armed, desired=${desired}, write_blocked=${input.blockReason}`;
		}
		return `live_test=armed, desired=${desired}, waiting_for_execution`;
	}

	if (input.releaseReason === "external_authority") {
		return "authority=external, ownership_released=true, action=no_write";
	}
	if (input.releaseReason === "actual_mode_changed_externally") {
		return "actual_mode_changed_externally, ownership_lost=true";
	}
	if (input.action === "release_off") {
		const label = ownershipLabel(ownership ?? "ems", owned);
		const blocked = input.blockReason && !input.writeAllowed ? `, write_blocked=${input.blockReason}` : "";
		return `desired=noop, ownership=${label}, valid_plan_end=true, action=release_off${blocked}`;
	}
	if (desired === "noop") {
		if (ownership != null) {
			return `desired=noop, ownership=${ownershipLabel(ownership, owned)}, action=noop`;
		}
		return `desired=noop, reason=${reason || "no_wallbox_action"}`;
	}
	if (reason === "explicit_stop" && input.phase === "idle" && !input.failsafeReason && !input.writeAllowed) {
		if (input.blockReason) {
			return `desired=off, reason=explicit_stop, write_blocked=${input.blockReason}`;
		}
		return `desired=off, reason=explicit_stop`;
	}
	if (input.failsafeReason) {
		if (input.failsafeReason === "evcc_source_stale" || input.failsafeReason === "evcc_source_offline") {
			return `desired=${desired}, write_blocked=${input.failsafeReason}`;
		}
		if (input.failsafeReason === "status_mode_stale") {
			return `desired=${desired}, write_blocked=evcc_source_stale`;
		}
		return `desired=${desired}, authority=${input.authority}, failsafe=${input.failsafeReason}`;
	}
	if (input.blockReason && !input.writeAllowed) {
		return `desired=${desired}, authority=${input.authority}, write_blocked=${input.blockReason}`;
	}
	if (input.phase === "awaiting_feedback" || input.phase === "command_sent" || input.phase === "retry") {
		return `desired=${desired}, authority=${input.authority}, ${input.phase}`;
	}
	if (input.phase === "confirmed" && input.actual === input.desired) {
		if (input.sourceFresh === true) {
			return `desired=${desired}, actual=${actual}, source_fresh=true`;
		}
		return `desired=${desired}, actual=${actual}, confirmed`;
	}
	return `desired=${desired}, actual=${actual}, authority=${input.authority}, ${input.phase}`;
}
