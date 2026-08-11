/**
 * Climate STOP-Intent / Retry-Kampagne — Generation gegen stale OFF-Writes.
 *
 * Es gibt keinen zeitgesteuerten Hintergrund-Retry-Timer. „retry stop“ bedeutet:
 * aktueller Tick will STOP und lastStopAtMs ist gesetzt.
 *
 * Stale-Schutz: eine STOP-Kampagne aus einer älteren Desired-Generation darf
 * nicht mehr schreiben, wenn die aktuelle authoritative Entscheidung ON/HOLD ist.
 */

import type { AcUnitDailyPlanResolution, AcCoolingPermissionResult } from "./daily_plan";
import type { AcUnitFsmResult } from "./fsm";
import type { AcUnitPersist } from "./persist";

export type AcCoolingDesired = "on" | "off" | "hold" | "idle";

export type StopIntentDecision =
	| { action: "execute_stop"; reasonDe: string; isRetry: boolean }
	| { action: "cancel_stale"; reasonDe: string }
	| { action: "wait_retry"; reasonDe: string }
	| { action: "none"; reasonDe: string };

export function plannerCoolingBudgetOn(dailyPlan: AcUnitDailyPlanResolution): boolean {
	return (
		dailyPlan.useDailyPlan &&
		dailyPlan.allocatedPowerW !== null &&
		Number.isFinite(dailyPlan.allocatedPowerW) &&
		dailyPlan.allocatedPowerW > 0
	);
}

/**
 * Aktuelle gewünschte Kühl-Kommando-Lage aus Permission + FSM + Feedback.
 * Planner-ON mit laufendem Gerät ohne demandStop → hold (kein Stop).
 */
export function resolveCoolingDesired(input: {
	permission: AcCoolingPermissionResult;
	fsm: AcUnitFsmResult;
	dailyPlan: AcUnitDailyPlanResolution;
	feedbackOn: boolean;
}): AcCoolingDesired {
	const { permission, fsm, dailyPlan, feedbackOn } = input;
	if (permission.allowStop) return "off";
	if (permission.allowStart) return "on";
	if (feedbackOn && plannerCoolingBudgetOn(dailyPlan) && !fsm.demandStop) return "hold";
	if (feedbackOn && !fsm.demandStop && !dailyPlan.useDailyPlan) return "hold";
	return "idle";
}

export function ensureStopIntentFields(up: AcUnitPersist): void {
	if (typeof up.commandGeneration !== "number" || !Number.isFinite(up.commandGeneration)) {
		up.commandGeneration = 0;
	}
	if (up.stopArmedGeneration !== null && typeof up.stopArmedGeneration !== "number") {
		up.stopArmedGeneration = null;
	}
	if (up.lastDesired == null) {
		up.lastDesired = null;
	}
}

/** Desired-Wechsel erhöht die Kommando-Generation; ON/HOLD invalidiert STOP-Kampagnen. */
export function advanceCoolingDesired(up: AcUnitPersist, desired: AcCoolingDesired): {
	generationBumped: boolean;
	stopCleared: boolean;
} {
	ensureStopIntentFields(up);
	let generationBumped = false;
	let stopCleared = false;
	if (up.lastDesired !== desired) {
		up.commandGeneration += 1;
		up.lastDesired = desired;
		generationBumped = true;
	}
	if (desired === "on" || desired === "hold") {
		if (up.stopArmedGeneration != null) {
			up.stopArmedGeneration = null;
			stopCleared = true;
		}
	}
	return { generationBumped, stopCleared };
}

/** Nach erfolgreichem START: STOP-Kampagne der Vorperiode verwerfen. */
export function clearStopIntentAfterStart(up: AcUnitPersist): void {
	ensureStopIntentFields(up);
	up.stopArmedGeneration = null;
	/** Alte Stop-Timestamps dürfen keinen „Retry“-Schein gegen den neuen Start erzeugen. */
	up.lastStopAtMs = null;
}

/**
 * Entscheidet, ob ein Stop-Write ausgeführt werden darf.
 * I1: nur bei aktuellem Desired OFF.
 * I2/I3: STOP-Kampagne muss zur aktuellen commandGeneration gehören.
 */
export function decideStopWrite(input: {
	up: AcUnitPersist;
	desired: AcCoolingDesired;
	feedbackOn: boolean;
	stopRetryReady: boolean;
	lastStopAtMs: number | null;
	nowMs: number;
}): StopIntentDecision {
	const { up, desired, feedbackOn, stopRetryReady } = input;
	ensureStopIntentFields(up);

	if (!feedbackOn) {
		up.stopArmedGeneration = null;
		return { action: "none", reasonDe: "feedback already off" };
	}

	if (desired === "on" || desired === "hold") {
		const hadArmed = up.stopArmedGeneration != null;
		up.stopArmedGeneration = null;
		if (hadArmed) {
			return {
				action: "cancel_stale",
				reasonDe: "stop retry cancelled — current planner intent is ON",
			};
		}
		return { action: "none", reasonDe: "desired on/hold — no stop" };
	}

	if (desired !== "off") {
		up.stopArmedGeneration = null;
		return { action: "none", reasonDe: "desired not off" };
	}

	/** Stale: Kampagne aus älterer Generation (z. B. nach ON und zurück). */
	if (up.stopArmedGeneration != null && up.stopArmedGeneration !== up.commandGeneration) {
		up.stopArmedGeneration = null;
		return {
			action: "cancel_stale",
			reasonDe: "stop retry cancelled — stop intent generation superseded",
		};
	}

	if (up.stopArmedGeneration == null) {
		up.stopArmedGeneration = up.commandGeneration;
	}

	if (!stopRetryReady) {
		return { action: "wait_retry", reasonDe: "stop retry cooldown active" };
	}

	const isRetry = input.lastStopAtMs != null;
	return {
		action: "execute_stop",
		reasonDe: isRetry ? "stop retry — current planner intent still OFF" : "stop — current planner intent OFF",
		isRetry,
	};
}
