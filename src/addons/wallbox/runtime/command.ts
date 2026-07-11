import type { WallboxDispatchAction } from "./intent";
import type { WallboxPlanDecision } from "./daily_plan";
import type { WallboxDryrunDispatchResult, WallboxDispatchReadiness } from "./dispatch";

export type WallboxCommandAction = WallboxDispatchAction;

export interface WallboxCommandCandidate {
	action: WallboxCommandAction;
	targetPowerW: number | null;
	targetCurrentA: number | null;
	energySource: string | null;
	connected: boolean;
	technicallyReady: boolean;
	dispatchRevision: number | null;
	planRevision: number | null;
	createdAt: string;
	blocked: boolean;
	blockReason: string | null;
}

function isFiniteNonNegative(n: number | null): boolean {
	return n !== null && Number.isFinite(n) && n >= 0;
}

function validateChargeCandidate(
	decision: WallboxPlanDecision,
	dispatch: WallboxDryrunDispatchResult,
	readiness: WallboxDispatchReadiness,
): { ready: boolean; reason: string | null } {
	// Technische Min-/Max-Leistung aus EVCC-Telemetrie (resolveWallboxPowerLimits in daily_plan.ts),
	// im WallboxPlanDecision-Snapshot — nicht aus der Allocation selbst.
	if (!decision.connected) {
		return { ready: false, reason: "vehicle_disconnected" };
	}
	if (!dispatch.target.valid) {
		return { ready: false, reason: "dispatch_invalid" };
	}
	if (dispatch.intent.action !== "charge") {
		return { ready: false, reason: "action_not_charge" };
	}
	if (!isFiniteNonNegative(dispatch.target.targetPowerW)) {
		return { ready: false, reason: "invalid_target_power" };
	}
	if ((dispatch.target.targetPowerW ?? 0) <= 0) {
		return { ready: false, reason: "non_positive_target_power" };
	}
	if (dispatch.target.targetCurrentA !== null && !isFiniteNonNegative(dispatch.target.targetCurrentA)) {
		return { ready: false, reason: "invalid_target_current" };
	}
	if (dispatch.target.targetCurrentA !== null && (dispatch.target.targetCurrentA ?? 0) <= 0) {
		return { ready: false, reason: "non_positive_target_current" };
	}
	if (
		decision.minChargePowerW !== null &&
		dispatch.target.targetPowerW !== null &&
		dispatch.target.targetPowerW > 0 &&
		dispatch.target.targetPowerW < decision.minChargePowerW
	) {
		return { ready: false, reason: "below_min_charge_power" };
	}
	if (
		decision.maxChargePowerW !== null &&
		dispatch.target.targetPowerW !== null &&
		dispatch.target.targetPowerW > decision.maxChargePowerW
	) {
		return { ready: false, reason: "above_max_charge_power" };
	}
	if (!readiness.controlMappingComplete) {
		return { ready: false, reason: "mapping_incomplete" };
	}
	return { ready: true, reason: null };
}

export interface BuildWallboxCommandCandidateInput {
	dispatch: WallboxDryrunDispatchResult;
	decision: WallboxPlanDecision;
	now: Date;
}

export function buildWallboxCommandCandidate(input: BuildWallboxCommandCandidateInput): WallboxCommandCandidate {
	const { dispatch, decision, now } = input;
	const action = dispatch.intent.action;
	const readiness = dispatch.readiness;
	const createdAt = now.toISOString();

	const base = {
		action,
		targetPowerW: action === "charge" ? dispatch.target.targetPowerW : action === "hold" ? 0 : 0,
		targetCurrentA: action === "charge" ? dispatch.target.targetCurrentA : null,
		energySource: dispatch.intent.source,
		connected: decision.connected,
		dispatchRevision: dispatch.intent.dailyPlanRevision,
		planRevision: decision.dailyPlanRevision,
		createdAt,
	};

	if (!decision.connected) {
		return {
			...base,
			action: "none",
			targetPowerW: 0,
			targetCurrentA: null,
			technicallyReady: false,
			blocked: true,
			blockReason: "vehicle_disconnected",
		};
	}

	if (action === "none") {
		return {
			...base,
			technicallyReady: false,
			blocked: true,
			blockReason: "dispatch_none",
		};
	}

	if (action === "hold") {
		return {
			...base,
			targetPowerW: 0,
			targetCurrentA: null,
			technicallyReady: true,
			blocked: true,
			blockReason: "hold_requested",
		};
	}

	const chargeCheck = validateChargeCandidate(decision, dispatch, readiness);
	return {
		...base,
		technicallyReady: chargeCheck.ready,
		blocked: !chargeCheck.ready,
		blockReason: chargeCheck.reason,
	};
}
