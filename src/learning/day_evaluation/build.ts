import type { UnifiedDayPlan } from "../../operator/daily_plan/unified/types";
import {
	absError,
	pctError,
	type DayEvaluationRecord,
	type GoalOutcome,
} from "./types";

export type DayEvalActuals = {
	actualPvKwh: number | null;
	actualHouseLoadKwh: number | null;
	actualGridImportKwh: number | null;
	actualGridExportKwh: number | null;
	actualGridCostCt: number | null;
	actualBatteryEndSocPct: number | null;
	actualBatteryChargedKwh: number | null;
	actualImmersionKwh: number | null;
	actualImmersionEndTempC: number | null;
	actualClimateKwh: number | null;
	climateComfortViolations: number | null;
	actualVehicleChargeKwh: number | null;
	actualVehicleGridCostCt: number | null;
	actualVehicleSocPct: number | null;
};

export type DayEvalSessionSnapshot = {
	date: string;
	timezone: string;
	initialPlanId: string | null;
	finalPlanId: string | null;
	initialGeneration: number | null;
	finalGeneration: number | null;
	replanCount: number;
	replanReasons: string[];
	inputRevision: number | null;
	plannerConfidencePct: number | null;
	plannerDegraded: boolean;
	initialExpectedPvKwh: number | null;
	finalExpectedPvKwh: number | null;
	expectedHouseLoadKwh: number | null;
	expectedGridImportKwh: number | null;
	expectedGridExportKwh: number | null;
	expectedGridCostCt: number | null;
	batteryStartSocPct: number | null;
	plannedBatteryEndSocPct: number | null;
	plannedBatteryChargedKwh: number | null;
	plannedImmersionKwh: number | null;
	plannedImmersionTargetTempC: number | null;
	plannedClimateKwh: number | null;
	vehiclePlannedPvKwh: number | null;
	vehiclePlannedGridKwh: number | null;
	vehiclePlannedGridCostCt: number | null;
	vehicleTargetSocPct: number | null;
	vehicleRequiredEnergyKwh: number | null;
	vehicleSavingsCt: number | null;
	vehicleEconomicsCompleteness: "full" | "grid_only" | "unknown" | null;
	goals: GoalOutcome[];
};

function sumKind(plan: UnifiedDayPlan | null, kind: string): number | null {
	if (!plan) return null;
	const cells = plan.allocations.filter((a) => a.kind === kind);
	if (!cells.length) return 0;
	return Math.round(cells.reduce((s, a) => s + a.allocatedEnergyKwh, 0) * 1000) / 1000;
}

function plannedBatteryEndSoc(plan: UnifiedDayPlan | null, startSoc: number | null): number | null {
	if (!plan?.batteryTrajectory?.length) return null;
	const last = plan.batteryTrajectory[plan.batteryTrajectory.length - 1];
	return last?.socPct ?? null;
}

function goalsFromPlan(plan: UnifiedDayPlan | null): GoalOutcome[] {
	if (!plan) return [];
	return plan.goalStatuses.map((g) => ({
		consumerId: g.consumerId,
		goalId: g.goalId,
		status: g.met === true ? "reached" : g.met === false ? "missed" : "unknown",
		reasonCodes: [],
	}));
}

/** Session-Snapshot aus finalem Unified-Plan + laufender Session-Meta. */
export function snapshotFromUnifiedSession(input: {
	date: string;
	timezone: string;
	initialPlanId: string | null;
	finalPlan: UnifiedDayPlan | null;
	initialGeneration: number | null;
	replanCount: number;
	replanReasons: string[];
	initialExpectedPvKwh: number | null;
	batteryStartSocPct: number | null;
	plannedImmersionTargetTempC: number | null;
}): DayEvalSessionSnapshot {
	const plan = input.finalPlan;
	const eco = plan?.vehicleChargeEconomics ?? null;
	const batCharge = sumKind(plan, "battery_charge");
	return {
		date: input.date,
		timezone: input.timezone,
		initialPlanId: input.initialPlanId,
		finalPlanId: plan?.planId ?? null,
		initialGeneration: input.initialGeneration,
		finalGeneration: plan?.generation ?? null,
		replanCount: input.replanCount,
		replanReasons: [...new Set(input.replanReasons)],
		inputRevision: plan?.inputRevision ?? null,
		plannerConfidencePct: plan?.confidence?.confidencePct ?? null,
		plannerDegraded: plan?.confidence?.status !== "valid",
		initialExpectedPvKwh: input.initialExpectedPvKwh,
		finalExpectedPvKwh: plan?.expectedPvEnergyKwh ?? null,
		expectedHouseLoadKwh: plan?.expectedHouseLoadEnergyKwh ?? null,
		expectedGridImportKwh: plan?.expectedGridImportEnergyKwh ?? null,
		expectedGridExportKwh: plan?.expectedGridExportEnergyKwh ?? null,
		expectedGridCostCt: plan?.expectedCostCt ?? null,
		batteryStartSocPct: input.batteryStartSocPct,
		plannedBatteryEndSocPct: plannedBatteryEndSoc(plan, input.batteryStartSocPct),
		plannedBatteryChargedKwh: batCharge,
		plannedImmersionKwh: sumKind(plan, "immersion_heater"),
		plannedImmersionTargetTempC: input.plannedImmersionTargetTempC,
		plannedClimateKwh: sumKind(plan, "climate"),
		vehiclePlannedPvKwh: eco?.expectedPvChargeKwh ?? null,
		vehiclePlannedGridKwh: eco?.expectedGridChargeKwh ?? null,
		vehiclePlannedGridCostCt: eco?.expectedGridCostCt ?? null,
		vehicleTargetSocPct: null,
		vehicleRequiredEnergyKwh: eco?.requiredEnergyKwh ?? null,
		vehicleSavingsCt: eco?.savingsVsAlternativeCt ?? null,
		vehicleEconomicsCompleteness: eco?.economicsCompleteness ?? null,
		goals: goalsFromPlan(plan),
	};
}

export function buildDayEvaluationRecord(
	session: DayEvalSessionSnapshot,
	actuals: DayEvalActuals,
	evaluatedAt: Date,
): DayEvaluationRecord {
	const pvAbs = absError(session.initialExpectedPvKwh, actuals.actualPvKwh);
	const pvPct = pctError(session.initialExpectedPvKwh, actuals.actualPvKwh);

	let immersionReached: boolean | null = null;
	if (
		session.plannedImmersionTargetTempC !== null &&
		actuals.actualImmersionEndTempC !== null
	) {
		immersionReached = actuals.actualImmersionEndTempC >= session.plannedImmersionTargetTempC - 0.5;
	}

	let vehicleReached: boolean | null = null;
	if (session.vehicleRequiredEnergyKwh !== null && actuals.actualVehicleChargeKwh !== null) {
		vehicleReached = actuals.actualVehicleChargeKwh + 0.2 >= session.vehicleRequiredEnergyKwh;
	} else if (session.vehicleTargetSocPct !== null && actuals.actualVehicleSocPct !== null) {
		vehicleReached = actuals.actualVehicleSocPct + 1 >= session.vehicleTargetSocPct;
	}

	const goals = session.goals.map((g) => {
		if (g.consumerId === "wallbox" && vehicleReached !== null) {
			return {
				...g,
				status: (vehicleReached ? "reached" : "missed") as GoalOutcome["status"],
				reasonCodes: vehicleReached ? g.reasonCodes : [...g.reasonCodes, "vehicle_goal_missed"],
			};
		}
		return g;
	});

	return {
		schemaVersion: 1,
		evaluatedAtIso: evaluatedAt.toISOString(),
		plan: {
			date: session.date,
			timezone: session.timezone,
			initialPlanId: session.initialPlanId,
			finalPlanId: session.finalPlanId,
			initialGeneration: session.initialGeneration,
			finalGeneration: session.finalGeneration,
			replanCount: session.replanCount,
			replanReasons: [...session.replanReasons],
			inputRevision: session.inputRevision,
			plannerConfidencePct: session.plannerConfidencePct,
			plannerDegraded: session.plannerDegraded,
		},
		pv: {
			initialExpectedKwh: session.initialExpectedPvKwh,
			finalExpectedKwh: session.finalExpectedPvKwh,
			actualKwh: actuals.actualPvKwh,
			absoluteErrorKwh: pvAbs,
			percentageErrorPct: pvPct,
		},
		houseLoad: {
			expectedKwh: session.expectedHouseLoadKwh,
			actualKwh: actuals.actualHouseLoadKwh,
			deviationKwh: absError(session.expectedHouseLoadKwh, actuals.actualHouseLoadKwh),
		},
		grid: {
			expectedImportKwh: session.expectedGridImportKwh,
			actualImportKwh: actuals.actualGridImportKwh,
			expectedExportKwh: session.expectedGridExportKwh,
			actualExportKwh: actuals.actualGridExportKwh,
			expectedCostCt: session.expectedGridCostCt,
			actualCostCt: actuals.actualGridCostCt,
		},
		battery: {
			startSocPct: session.batteryStartSocPct,
			plannedEndSocPct: session.plannedBatteryEndSocPct,
			actualEndSocPct: actuals.actualBatteryEndSocPct,
			plannedChargedKwh: session.plannedBatteryChargedKwh,
			actualChargedKwh: actuals.actualBatteryChargedKwh,
		},
		immersion: {
			plannedKwh: session.plannedImmersionKwh,
			actualKwh: actuals.actualImmersionKwh,
			plannedTargetTempC: session.plannedImmersionTargetTempC,
			targetReached: immersionReached,
		},
		climate: {
			plannedKwh: session.plannedClimateKwh,
			actualKwh: actuals.actualClimateKwh,
			comfortViolations: actuals.climateComfortViolations,
		},
		vehicle: {
			plannedPvChargeKwh: session.vehiclePlannedPvKwh,
			plannedGridChargeKwh: session.vehiclePlannedGridKwh,
			actualChargeKwh: actuals.actualVehicleChargeKwh,
			targetSocPct: session.vehicleTargetSocPct,
			requiredEnergyKwh: session.vehicleRequiredEnergyKwh,
			targetReached: vehicleReached,
			plannedGridCostCt: session.vehiclePlannedGridCostCt,
			actualGridCostCt: actuals.actualVehicleGridCostCt,
			savingsVsEarliestFeasibleCt: session.vehicleSavingsCt,
			economicsCompleteness: session.vehicleEconomicsCompleteness,
		},
		goals,
		learningApplied: false,
	};
}
