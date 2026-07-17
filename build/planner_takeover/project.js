"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.projectCandidateToNormalizedPlan = exports.NORMALIZED_PLAN_SCHEMA_VERSION = void 0;
const node_crypto_1 = require("node:crypto");
const canonical_1 = require("../planner_preparation/canonical");
const canonize_1 = require("./canonize");
exports.NORMALIZED_PLAN_SCHEMA_VERSION = 1;
/**
 * Project a plan candidate onto the shared normalized comparison contract.
 * Pure — no IO, no state writes. Ignores job ids, paths, generatedAt text diagnostics.
 */
function projectCandidateToNormalizedPlan(candidate) {
    const slots = candidate.forecastSlots.map((s) => ({
        start: (0, canonize_1.canonicalizeUtcIso)(s.start),
        end: (0, canonize_1.canonicalizeUtcIso)(s.end),
        pvPowerW: (0, canonize_1.canonicalizePowerW)(s.pvPowerW),
        houseLoadPowerW: (0, canonize_1.canonicalizePowerW)(s.houseLoadPowerW),
        fixedBalancePowerW: (0, canonize_1.canonicalizePowerW)(s.fixedBalancePowerW),
        gridPriceCtPerKwh: (0, canonize_1.canonicalizePriceCt)(s.gridPriceCtPerKwh),
        gridImportAllowed: s.gridImportAllowed,
        gridMaxImportPowerW: (0, canonize_1.canonicalizePowerW)(s.gridMaxImportPowerW),
    }));
    const allocations = [...candidate.allocations]
        .map((a) => ({
        contributionId: a.contributionId,
        slotStart: (0, canonize_1.canonicalizeUtcIso)(a.slotStart),
        slotEnd: (0, canonize_1.canonicalizeUtcIso)(a.slotEnd),
        powerW: (0, canonize_1.canonicalizePowerW)(a.powerW),
        energyKwh: (0, canonize_1.canonicalizeEnergyKwh)(a.energyKwh),
        status: a.status,
    }))
        .sort((x, y) => {
        const c = x.contributionId.localeCompare(y.contributionId);
        if (c !== 0)
            return c;
        return x.slotStart.localeCompare(y.slotStart);
    });
    const first = slots[0];
    const last = slots[slots.length - 1];
    const slotMinutes = first && last ? (0, canonize_1.slotDurationMinutes)(first.start, first.end) : 15;
    const base = {
        schemaVersion: exports.NORMALIZED_PLAN_SCHEMA_VERSION,
        horizon: {
            start: (0, canonize_1.canonicalizeUtcIso)(candidate.horizonStart),
            end: (0, canonize_1.canonicalizeUtcIso)(candidate.horizonEnd),
            slotMinutes,
        },
        slots,
        allocations,
        totals: {
            flexibleAllocatedEnergyKwh: (0, canonize_1.canonicalizeEnergyKwh)(candidate.totals.flexibleAllocatedEnergyKwh),
            flexibleUnallocatedEnergyKwh: (0, canonize_1.canonicalizeEnergyKwh)(candidate.totals.flexibleUnallocatedEnergyKwh),
            pvForecastEnergyKwh: (0, canonize_1.canonicalizeEnergyKwh)(candidate.totals.pvForecastEnergyKwh),
            fixedHouseLoadEnergyKwh: (0, canonize_1.canonicalizeEnergyKwh)(candidate.totals.fixedHouseLoadEnergyKwh),
        },
        constraintsRevision: candidate.preparationRevision,
        validationStatus: candidate.validationStatus,
        forecastStatus: candidate.forecastStatus,
        dailyStatus: candidate.dailyStatus,
        qualityCodes: [...candidate.qualityCodes].sort(),
    };
    return {
        ...base,
        semanticRevision: (0, node_crypto_1.createHash)("sha256")
            .update(JSON.stringify((0, canonical_1.sortKeysDeep)(base)), "utf8")
            .digest("hex"),
    };
}
exports.projectCandidateToNormalizedPlan = projectCandidateToNormalizedPlan;
