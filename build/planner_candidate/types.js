"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildPlanCandidateFromPlans = exports.computeCandidateRevision = exports.PLANNER_CANDIDATE_BUDGET_BYTES = exports.PLANNER_CANDIDATE_FILE = exports.PLANNER_CANDIDATE_SCHEMA_VERSION = void 0;
const node_crypto_1 = require("node:crypto");
const canonical_1 = require("../planner_preparation/canonical");
exports.PLANNER_CANDIDATE_SCHEMA_VERSION = 1;
exports.PLANNER_CANDIDATE_FILE = "plan_candidate_v1.json";
exports.PLANNER_CANDIDATE_BUDGET_BYTES = 512 * 1024;
function computeCandidateRevision(candidate) {
    return (0, node_crypto_1.createHash)("sha256").update(JSON.stringify((0, canonical_1.sortKeysDeep)(candidate)), "utf8").digest("hex");
}
exports.computeCandidateRevision = computeCandidateRevision;
function buildPlanCandidateFromPlans(input) {
    const forecastSlots = input.forecast.slots.map((s) => ({
        start: s.slot.startIso,
        end: s.slot.endIso,
        pvPowerW: s.pvPowerW,
        houseLoadPowerW: s.houseLoadPowerW,
        fixedBalancePowerW: s.fixedBalancePowerW,
        gridPriceCtPerKwh: s.gridPriceCtPerKwh,
        gridImportAllowed: s.gridImportAllowed,
        gridMaxImportPowerW: s.gridMaxImportPowerW,
    }));
    const allocations = input.daily.allocations.map((a) => ({
        contributionId: a.contributionId,
        slotStart: a.slot.startIso,
        slotEnd: a.slot.endIso,
        powerW: a.allocatedPowerW,
        energyKwh: a.allocatedEnergyKwh,
        status: a.status,
    }));
    const contributions = input.contributions.map((c) => ({
        contributionId: c.contributionId,
        enabled: c.enabled,
        flexible: c.flexible,
        gridEligible: c.gridEligible,
        qualityStatus: c.quality.status,
    }));
    const qualityCodes = [];
    if (input.forecast.status !== "ready")
        qualityCodes.push(`forecast_${input.forecast.status}`);
    if (input.daily.status !== "ready")
        qualityCodes.push(`daily_${input.daily.status}`);
    const validationStatus = input.forecast.status === "missing_inputs" || input.daily.status === "missing_inputs"
        ? "failed"
        : input.forecast.status === "degraded" || input.daily.status === "degraded"
            ? "degraded"
            : "ok";
    const base = {
        schemaVersion: exports.PLANNER_CANDIDATE_SCHEMA_VERSION,
        inputRevision: input.inputRevision,
        preparationRevision: input.preparationRevision,
        capturedAt: input.capturedAt,
        timezone: input.timezone,
        horizonStart: input.horizonStart,
        horizonEnd: input.horizonEnd,
        slotCount: forecastSlots.length,
        forecastStatus: String(input.forecast.status),
        dailyStatus: String(input.daily.status),
        validationStatus,
        qualityCodes,
        contributions,
        forecastSlots,
        allocations,
        totals: {
            flexibleAllocatedEnergyKwh: input.daily.totals.flexibleAllocatedEnergyKwh,
            flexibleUnallocatedEnergyKwh: input.daily.totals.flexibleUnallocatedEnergyKwh,
            pvForecastEnergyKwh: input.daily.totals.pvForecastEnergyKwh,
            fixedHouseLoadEnergyKwh: input.daily.totals.fixedHouseLoadEnergyKwh,
        },
    };
    return {
        ...base,
        candidateRevision: computeCandidateRevision(base),
        generatedAt: input.capturedAt,
    };
}
exports.buildPlanCandidateFromPlans = buildPlanCandidateFromPlans;
