import type { SonnenFeedbackTolerance, SonnenModeValues, SonnenSequenceConfig } from "../config";
import type { BatteryAction } from "../core/types";
import type { BatteryWriteKind } from "./execute";
import { checkChargeFeedback, checkModeFeedback } from "./feedback";
import { emptyOwnership, type OwnershipState } from "./ownership";

export type SonnenFsmState =
	| "idle"
	| "validate"
	| "prepare"
	| "pause_grid_balance"
	| "wait_before_manual_mode"
	| "set_manual_mode"
	| "wait_after_manual_mode"
	| "verify_manual_mode"
	| "set_charge_power"
	| "verify_charge_power"
	| "active"
	| "stop_charge"
	| "verify_charge_stopped"
	| "restore_self_consumption"
	| "verify_self_consumption"
	| "restore_grid_balance"
	| "completed"
	| "rejected"
	| "fault"
	| "lockout";

export interface SonnenRuntime {
	state: SonnenFsmState;
	stateEnteredMs: number;
	requestId: string | null;
	action: BatteryAction | null;
	effectivePowerW: number;
	targetSocPct: number | null;
	ownership: OwnershipState;
	gridBalanceWasActive: boolean;
	faultCode: string | null;
	faultReason: string | null;
	faultSinceMs: number | null;
	lockout: boolean;
	lockoutReason: string | null;
}

export function initialSonnenRuntime(nowMs: number): SonnenRuntime {
	return {
		state: "idle",
		stateEnteredMs: nowMs,
		requestId: null,
		action: null,
		effectivePowerW: 0,
		targetSocPct: null,
		ownership: emptyOwnership(),
		gridBalanceWasActive: false,
		faultCode: null,
		faultReason: null,
		faultSinceMs: null,
		lockout: false,
		lockoutReason: null,
	};
}

export interface PlannedBatteryWrite {
	kind: BatteryWriteKind;
	value: number;
	expectedFeedback: number | null;
}

export type GridBalanceCommand = "pause" | "restore" | null;

export interface SonnenFsmContext {
	nowMs: number;
	intentValid: boolean;
	chargingActionRequested: boolean;
	action: BatteryAction | null;
	requestId: string | null;
	effectiveChargeW: number;
	targetSocPct: number | null;
	/** Non-null = aktive Aktion muss kontrolliert beendet werden. */
	stopReason: string | null;
	actualMode: number | null;
	actualChargingW: number | null;
	socPct: number | null;
	modeValues: SonnenModeValues;
	sequence: SonnenSequenceConfig;
	tolerance: SonnenFeedbackTolerance;
	gridBalanceActive: boolean;
	/** Dryrun: Rückmeldungen werden simuliert (Gerät spiegelt keine Writes). */
	simulateFeedback: boolean;
}

export interface SonnenFsmStep {
	runtime: SonnenRuntime;
	writes: PlannedBatteryWrite[];
	gridBalance: GridBalanceCommand;
	log: { level: "info" | "debug" | "warn" | "error"; msg: string } | null;
	transitioned: boolean;
}

const STOPPABLE_STATES = new Set<SonnenFsmState>([
	"wait_after_manual_mode",
	"verify_manual_mode",
	"set_charge_power",
	"verify_charge_power",
	"active",
]);

/** Reine FSM-Transition. Dieselbe Logik wird in Dryrun und Live verwendet. */
export function stepSonnenFsm(prev: SonnenRuntime, ctx: SonnenFsmContext): SonnenFsmStep {
	const rt: SonnenRuntime = { ...prev, ownership: { ...prev.ownership } };
	const writes: PlannedBatteryWrite[] = [];
	let gridBalance: GridBalanceCommand = null;
	let log: SonnenFsmStep["log"] = null;
	const from = rt.state;
	const elapsed = ctx.nowMs - rt.stateEnteredMs;

	const enter = (state: SonnenFsmState): void => {
		rt.state = state;
		rt.stateEnteredMs = ctx.nowMs;
	};
	const setFault = (code: string, reason: string): void => {
		rt.faultCode = code;
		rt.faultReason = reason;
		rt.faultSinceMs = ctx.nowMs;
	};

	// Sicherheitsabbruch in aktiven Sequenzzuständen.
	if (ctx.stopReason && STOPPABLE_STATES.has(rt.state)) {
		log = { level: "info", msg: `battery stop: ${ctx.stopReason}` };
		enter("stop_charge");
		return { runtime: rt, writes, gridBalance, log, transitioned: from !== rt.state };
	}

	switch (rt.state) {
		case "lockout":
		case "fault":
			break;

		case "idle":
		case "completed":
		case "rejected":
			if (ctx.stopReason && rt.ownership.active) {
				enter("stop_charge");
				break;
			}
			if (ctx.intentValid && ctx.chargingActionRequested && !rt.lockout && !ctx.stopReason) {
				rt.requestId = ctx.requestId;
				rt.action = ctx.action;
				rt.effectivePowerW = ctx.effectiveChargeW;
				rt.targetSocPct = ctx.targetSocPct;
				enter("validate");
			}
			break;

		case "validate":
			if (!ctx.intentValid || !ctx.chargingActionRequested) {
				log = { level: "warn", msg: "battery intent rejected at validate" };
				enter("rejected");
			} else {
				enter("prepare");
			}
			break;

		case "prepare":
			rt.ownership.originalMode = ctx.actualMode;
			rt.gridBalanceWasActive = ctx.gridBalanceActive;
			enter("pause_grid_balance");
			break;

		case "pause_grid_balance":
			gridBalance = "pause";
			enter("wait_before_manual_mode");
			break;

		case "wait_before_manual_mode":
			if (elapsed >= ctx.sequence.pauseBeforeManualMs) {
				enter("set_manual_mode");
			}
			break;

		case "set_manual_mode":
			writes.push({
				kind: "operating_mode",
				value: ctx.modeValues.manual,
				expectedFeedback: ctx.modeValues.manual,
			});
			rt.ownership.active = true;
			rt.ownership.manualModeWritten = true;
			rt.ownership.requestId = rt.requestId;
			rt.ownership.startedAt = new Date(ctx.nowMs).toISOString();
			log = { level: "info", msg: `battery live action started (${rt.action})` };
			enter("wait_after_manual_mode");
			break;

		case "wait_after_manual_mode":
			if (elapsed >= ctx.sequence.waitAfterManualMs) {
				enter("verify_manual_mode");
			}
			break;

		case "verify_manual_mode": {
			const outcome = ctx.simulateFeedback
				? "ok"
				: checkModeFeedback({
						expectedMode: ctx.modeValues.manual,
						actualMode: ctx.actualMode,
						elapsedMs: elapsed,
						timeoutMs: ctx.sequence.feedbackTimeoutModeMs,
					});
			if (outcome === "ok") {
				enter("set_charge_power");
			} else if (outcome === "timeout") {
				setFault("mode_feedback_timeout", "manual mode not confirmed");
				log = { level: "error", msg: "battery mode feedback timeout" };
				enter("stop_charge");
			}
			break;
		}

		case "set_charge_power":
			writes.push({
				kind: "charge_power",
				value: rt.effectivePowerW,
				expectedFeedback: rt.effectivePowerW,
			});
			enter("verify_charge_power");
			break;

		case "verify_charge_power": {
			const outcome = ctx.simulateFeedback
				? "ok"
				: checkChargeFeedback({
						expectedW: rt.effectivePowerW,
						actualChargingW: ctx.actualChargingW,
						elapsedMs: elapsed,
						timeoutMs: ctx.sequence.feedbackTimeoutChargeMs,
						tolerance: ctx.tolerance,
					});
			if (outcome === "ok") {
				enter("active");
			} else if (outcome === "timeout") {
				setFault("charge_feedback_timeout", "charge power not confirmed");
				log = { level: "error", msg: "battery charge feedback timeout" };
				enter("stop_charge");
			}
			break;
		}

		case "active":
			if (Math.abs(ctx.effectiveChargeW - rt.effectivePowerW) > ctx.tolerance.absoluteW) {
				rt.effectivePowerW = ctx.effectiveChargeW;
				enter("set_charge_power");
			}
			break;

		case "stop_charge":
			writes.push({ kind: "charge_power", value: 0, expectedFeedback: 0 });
			enter("verify_charge_stopped");
			break;

		case "verify_charge_stopped": {
			const outcome = ctx.simulateFeedback
				? "ok"
				: checkChargeFeedback({
						expectedW: 0,
						actualChargingW: ctx.actualChargingW,
						elapsedMs: elapsed,
						timeoutMs: ctx.sequence.feedbackTimeoutChargeMs,
						tolerance: ctx.tolerance,
					});
			if (outcome === "ok" || outcome === "timeout") {
				enter("restore_self_consumption");
			}
			break;
		}

		case "restore_self_consumption":
			writes.push({
				kind: "operating_mode",
				value: ctx.modeValues.selfConsumption,
				expectedFeedback: ctx.modeValues.selfConsumption,
			});
			enter("verify_self_consumption");
			break;

		case "verify_self_consumption": {
			const outcome = ctx.simulateFeedback
				? "ok"
				: checkModeFeedback({
						expectedMode: ctx.modeValues.selfConsumption,
						actualMode: ctx.actualMode,
						elapsedMs: elapsed,
						timeoutMs: ctx.sequence.feedbackTimeoutModeMs,
					});
			if (outcome === "ok") {
				enter("restore_grid_balance");
			} else if (outcome === "timeout") {
				setFault("restore_failed", "self consumption not confirmed");
				rt.lockout = true;
				rt.lockoutReason = "restore_failed";
				log = { level: "error", msg: "battery safe restore failed → lockout" };
				enter("lockout");
			}
			break;
		}

		case "restore_grid_balance":
			if (rt.gridBalanceWasActive) {
				gridBalance = "restore";
			}
			rt.ownership = emptyOwnership();
			if (rt.faultCode) {
				rt.lockout = true;
				rt.lockoutReason = "post_fault_restore";
				log = { level: "warn", msg: "battery restored after fault → lockout" };
				enter("lockout");
			} else {
				log = { level: "info", msg: "battery safe restore completed" };
				enter("completed");
			}
			break;
	}

	return { runtime: rt, writes, gridBalance, log, transitioned: from !== rt.state };
}

/** Fault/Lockout zurücksetzen (kein Geräte-Write, kein Moduswechsel). */
export function clearBatteryFault(prev: SonnenRuntime, nowMs: number): SonnenRuntime {
	if (prev.state !== "fault" && prev.state !== "lockout" && !prev.lockout && !prev.faultCode) {
		return prev;
	}
	return {
		...prev,
		state: "idle",
		stateEnteredMs: nowMs,
		faultCode: null,
		faultReason: null,
		faultSinceMs: null,
		lockout: false,
		lockoutReason: null,
		ownership: emptyOwnership(),
	};
}
