"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanCandidateFromSnapshot = void 0;
const build_1 = require("../operator/forecast/build");
const build_2 = require("../operator/daily_plan/build");
const mode_policy_1 = require("../planner/mode_policy");
const prepare_1 = require("../planner_preparation/prepare");
const from_snapshot_1 = require("./from_snapshot");
const types_1 = require("./types");
/**
 * Pure end-to-end candidate build from snapshot.
 * Same core functions for in-process reference and worker:
 * prepare → contributions → forecast → daily → normalized candidate.
 */
function buildPlanCandidateFromSnapshot(snapshot) {
    const prepared = (0, prepare_1.preparePlannerFromSnapshot)(snapshot);
    const { now, timezone, contributions } = (0, from_snapshot_1.collectContributionsFromSnapshot)(snapshot);
    const forecast = (0, build_1.buildForecastPlan)({ now, timezone, contributions });
    const modePolicy = (0, mode_policy_1.plannerModePolicyFromGlobalMode)(snapshot.general.globalMode);
    const daily = (0, build_2.buildDailyPlanFromForecast)(now, timezone, modePolicy.mode, forecast, {
        policySnapshot: {
            revision: snapshot.policy.revision,
            status: snapshot.policy.status,
            gridImportAllowed: snapshot.policy.gridImportAllowed,
            maxGridImportW: snapshot.policy.maxGridImportW,
            houseFuseLimitW: snapshot.policy.houseFuseLimitW,
        },
        energyPriority: snapshot.policy.energyPriority ?? [],
        mutualExclusions: snapshot.policy.mutualExclusions ?? [],
        gridImportAllowedPolicy: snapshot.policy.gridImportAllowed,
        effectiveMaxGridImportW: prepared.policy.effectiveMaxGridImportW,
        configuredHouseFuseLimitW: prepared.policy.configuredHouseFuseLimitW,
        modePolicy: {
            mode: modePolicy.mode,
            allowOptimization: modePolicy.allowOptimization,
        },
    });
    const candidate = (0, types_1.buildPlanCandidateFromPlans)({
        inputRevision: snapshot.inputRevision,
        preparationRevision: prepared.preparationRevision,
        capturedAt: snapshot.capturedAt,
        timezone,
        horizonStart: prepared.horizonStart || forecast.horizonStart,
        horizonEnd: prepared.horizonEnd || forecast.horizonEnd,
        forecast,
        daily,
        contributions,
    });
    return { prepared, candidate };
}
exports.buildPlanCandidateFromSnapshot = buildPlanCandidateFromSnapshot;
