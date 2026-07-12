"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.parseDailyPlanFromJson = exports.dailyPlanSemanticRevisionHash = exports.dailyPlanRevisionPayload = void 0;
const node_crypto_1 = require("node:crypto");
function slotForRevision(slot, index) {
    return {
        index,
        pvForecastPowerW: slot.pvForecastPowerW,
        fixedHouseLoadPowerW: slot.fixedHouseLoadPowerW,
        fixedBalancePowerW: slot.fixedBalancePowerW,
        gridPriceCtPerKwh: slot.gridPriceCtPerKwh,
        gridImportAllowed: slot.gridImportAllowed,
        allocatedFlexiblePowerW: slot.allocatedFlexiblePowerW,
        allocatedPvPowerW: slot.allocatedPvPowerW,
        allocatedGridPowerW: slot.allocatedGridPowerW,
        allocations: slot.allocations.map((a) => ({
            contributionId: a.contributionId,
            status: a.status,
            energySource: a.energySource,
            allocatedPowerW: a.allocatedPowerW,
            allocatedEnergyKwh: a.allocatedEnergyKwh,
            gridPowerW: a.gridPowerW,
            pvPowerW: a.pvPowerW,
            mandatory: a.mandatory,
            estimatedCostCt: a.estimatedCostCt,
        })),
    };
}
/** Semantic revision payload — allocation core only, no volatile metadata. */
function dailyPlanRevisionPayload(plan) {
    return JSON.stringify({
        date: plan.date,
        timezone: plan.timezone,
        globalMode: plan.globalMode,
        status: plan.status,
        activeContributionIds: plan.activeContributionIds,
        excludedContributions: plan.excludedContributions.map((e) => ({
            contributionId: e.contributionId,
        })),
        slots: plan.slots.map((slot, index) => slotForRevision(slot, index)),
        unallocated: plan.unallocated.map((u) => ({
            contributionId: u.contributionId,
            requestedEnergyKwh: u.requestedEnergyKwh,
            allocatedEnergyKwh: u.allocatedEnergyKwh,
            unallocatedEnergyKwh: u.unallocatedEnergyKwh,
        })),
        totals: plan.totals,
    });
}
exports.dailyPlanRevisionPayload = dailyPlanRevisionPayload;
function dailyPlanSemanticRevisionHash(plan) {
    return (0, node_crypto_1.createHash)("sha256").update(dailyPlanRevisionPayload(plan)).digest("hex");
}
exports.dailyPlanSemanticRevisionHash = dailyPlanSemanticRevisionHash;
function parseDailyPlanFromJson(raw) {
    if (!raw || !raw.trim())
        return null;
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slots))
            return null;
        return parsed;
    }
    catch {
        return null;
    }
}
exports.parseDailyPlanFromJson = parseDailyPlanFromJson;
