"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildAiOptimizationContext = exports.resolveAllowedAddonIds = void 0;
const registry_1 = require("../addons/governance/registry");
const config_1 = require("../addons/governance/config");
/** Nur Add-ons, die aktiv UND per Governance für KI-Optimierung freigegeben sind — sonst darf die KI sie nicht mal erwähnen. */
function resolveAllowedAddonIds(config) {
    return (0, registry_1.governedAddonIds)().filter((id) => (0, config_1.isAddonEnabled)(config, id) && (0, config_1.isAddonAiOptimizationAllowed)(config, id));
}
exports.resolveAllowedAddonIds = resolveAllowedAddonIds;
function digestFromDailyPlan(plan) {
    return {
        date: plan.date,
        globalMode: plan.globalMode,
        status: plan.status,
        activeContributionIds: plan.activeContributionIds,
        excludedContributionIds: plan.excludedContributions.map((e) => e.contributionId),
        totals: {
            pvForecastEnergyKwh: plan.totals.pvForecastEnergyKwh,
            flexibleAllocatedEnergyKwh: plan.totals.flexibleAllocatedEnergyKwh,
            flexibleUnallocatedEnergyKwh: plan.totals.flexibleUnallocatedEnergyKwh,
            estimatedGridCostCt: plan.totals.estimatedGridCostCt,
        },
        unallocated: plan.unallocated.map((u) => ({
            contributionId: u.contributionId,
            unallocatedEnergyKwh: u.unallocatedEnergyKwh,
            reasonDe: u.reasonDe,
        })),
    };
}
async function readJson(host, id) {
    try {
        const st = await host.getStateAsync(id);
        if (typeof st?.val !== "string" || !st.val)
            return {};
        const parsed = JSON.parse(st.val);
        return parsed && typeof parsed === "object" ? parsed : {};
    }
    catch {
        return {};
    }
}
/** Nur ausgewählte, unkritische Policy-Kennzahlen — kein voller Snapshot (Tokens sparen, kein Leck von Rohdaten). */
function pickPolicyHighlights(policy) {
    const limits = policy.limits;
    const economics = policy.economics;
    return {
        houseFuseLimitW: limits?.houseFuseLimitW?.value ?? null,
        maxGridImportW: limits?.maxGridImportW?.value ?? null,
        gridImportAllowed: economics?.gridImportAllowed?.value ?? null,
    };
}
async function buildAiOptimizationContext(host, plan, triggerReason) {
    const policyRaw = await readJson(host, "policy.global.effective_json");
    return {
        generatedAt: new Date().toISOString(),
        timezone: plan.timezone,
        globalMode: plan.globalMode,
        allowedAddonIds: resolveAllowedAddonIds(host.config),
        dailyPlan: digestFromDailyPlan(plan),
        policyHighlights: pickPolicyHighlights(policyRaw),
        triggerReason,
    };
}
exports.buildAiOptimizationContext = buildAiOptimizationContext;
