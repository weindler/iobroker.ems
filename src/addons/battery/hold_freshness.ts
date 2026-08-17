/**
 * Grid-Balance Hold: nur nachweislich aktuelle Signale.
 * Planner-Constraint-States dürfen nicht monatealte true-Werte behalten
 * (`setStateIfChanged` schreibt bei gleichem val nicht und lässt `ts` alt).
 */

export const PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS = 15 * 60 * 1000;

export type HoldStateLike = {
	val?: ioBroker.StateValue;
	ts?: number;
} | null | undefined;

export function isFreshTrue(
	st: HoldStateLike,
	nowMs: number,
	maxAgeMs = PLANNER_HOLD_CONSTRAINT_MAX_AGE_MS,
): boolean {
	if (!st || st.val !== true) return false;
	const ts = typeof st.ts === "number" && Number.isFinite(st.ts) ? st.ts : null;
	if (ts === null) return false;
	return nowMs - ts <= maxAgeMs;
}

/** EVCC battery_mode Hold — aktuell hold / holdcharge, nicht historische Constraint-States. */
export function isEvccBatteryHoldMode(mode: string | null | undefined): boolean {
	const m = String(mode ?? "").trim().toLowerCase();
	return m === "hold" || m === "holdcharge";
}

export function resolveGridBalanceHoldSignals(input: {
	nowMs: number;
	constraintHoldState: HoldStateLike;
	deviceIntentHold: boolean;
	batteryHoldForEvCharge: boolean;
	evccBatteryMode: string | null | undefined;
	evccDischargeControl: boolean;
}): {
	constraintHoldFresh: boolean;
	evccBatteryModeHold: boolean;
	holdPlanned: boolean;
	holdActive: boolean;
	holdDetected: boolean;
} {
	const constraintHoldFresh = isFreshTrue(input.constraintHoldState, input.nowMs);
	const evccBatteryModeHold = isEvccBatteryHoldMode(input.evccBatteryMode);
	const holdPlanned = input.deviceIntentHold === true;
	const holdActive =
		constraintHoldFresh ||
		input.batteryHoldForEvCharge === true ||
		evccBatteryModeHold ||
		input.evccDischargeControl === true;
	return {
		constraintHoldFresh,
		evccBatteryModeHold,
		holdPlanned,
		holdActive,
		holdDetected: holdPlanned || holdActive,
	};
}
