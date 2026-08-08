"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildDayEvaluationRecord = exports.snapshotFromUnifiedSession = void 0;
const types_1 = require("./types");
function sumKind(plan, kind) {
    if (!plan)
        return null;
    const cells = plan.allocations.filter((a) => a.kind === kind);
    if (!cells.length)
        return 0;
    return Math.round(cells.reduce((s, a) => s + a.allocatedEnergyKwh, 0) * 1000) / 1000;
}
function plannedBatteryEndSoc(plan, startSoc) {
    if (!plan?.batteryTrajectory?.length)
        return null;
    const last = plan.batteryTrajectory[plan.batteryTrajectory.length - 1];
    return last?.socPct ?? null;
}
function goalsFromPlan(plan) {
    if (!plan)
        return [];
    return plan.goalStatuses.map((g) => ({
        consumerId: g.consumerId,
        goalId: g.goalId,
        status: g.met === true ? "reached" : g.met === false ? "missed" : "unknown",
        reasonCodes: [],
    }));
}
/** Session-Snapshot aus finalem Unified-Plan + laufender Session-Meta. */
function snapshotFromUnifiedSession(input) {
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
exports.snapshotFromUnifiedSession = snapshotFromUnifiedSession;
function buildDayEvaluationRecord(session, actuals, evaluatedAt) {
    const pvAbs = (0, types_1.absError)(session.initialExpectedPvKwh, actuals.actualPvKwh);
    const pvPct = (0, types_1.pctError)(session.initialExpectedPvKwh, actuals.actualPvKwh);
    let immersionReached = null;
    if (session.plannedImmersionTargetTempC !== null &&
        actuals.actualImmersionEndTempC !== null) {
        immersionReached = actuals.actualImmersionEndTempC >= session.plannedImmersionTargetTempC - 0.5;
    }
    let vehicleReached = null;
    if (session.vehicleRequiredEnergyKwh !== null && actuals.actualVehicleChargeKwh !== null) {
        vehicleReached = actuals.actualVehicleChargeKwh + 0.2 >= session.vehicleRequiredEnergyKwh;
    }
    else if (session.vehicleTargetSocPct !== null && actuals.actualVehicleSocPct !== null) {
        vehicleReached = actuals.actualVehicleSocPct + 1 >= session.vehicleTargetSocPct;
    }
    const goals = session.goals.map((g) => {
        if (g.consumerId === "wallbox" && vehicleReached !== null) {
            return {
                ...g,
                status: (vehicleReached ? "reached" : "missed"),
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
            deviationKwh: (0, types_1.absError)(session.expectedHouseLoadKwh, actuals.actualHouseLoadKwh),
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
exports.buildDayEvaluationRecord = buildDayEvaluationRecord;
