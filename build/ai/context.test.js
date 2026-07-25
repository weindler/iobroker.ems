"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const context_js_1 = require("./context.js");
function minimalPlan(overrides = {}) {
    return {
        generatedAt: "2026-07-25T10:00:00.000Z",
        validUntil: null,
        revision: 1,
        date: "2026-07-25",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: ["immersion_heater"],
        excludedContributions: [{ contributionId: "wallbox", reasonDe: "nicht angesteckt" }],
        slots: [],
        allocations: [],
        unallocated: [
            {
                contributionId: "immersion_heater",
                requestedEnergyKwh: 3,
                allocatedEnergyKwh: 1.8,
                unallocatedEnergyKwh: 1.2,
                reasonDe: "PV reicht nicht",
            },
        ],
        totals: {
            pvForecastEnergyKwh: 12,
            fixedHouseLoadEnergyKwh: 8,
            fixedRenewableBalanceKwh: null,
            flexibleRequestedEnergyKwh: 3,
            flexibleAllocatedEnergyKwh: 1.8,
            flexibleUnallocatedEnergyKwh: 1.2,
            pvAllocatedEnergyKwh: 1.8,
            gridAllocatedEnergyKwh: 0,
            batteryChargeEnergyKwh: 0,
            wallboxEnergyKwh: 0,
            immersionHeaterEnergyKwh: 1.8,
            airConditioningEnergyKwh: 0,
            estimatedGridCostCt: 45,
            mandatoryRequestedEnergyKwh: null,
            mandatoryAllocatedEnergyKwh: 0,
            mandatoryUnallocatedEnergyKwh: null,
        },
        quality: { status: "valid", confidencePct: 100, reasonDe: "" },
        reasonDe: "Testplan",
        ...overrides,
    };
}
(0, node_test_1.describe)("ai resolveAllowedAddonIds", () => {
    (0, node_test_1.it)("empty when nothing is AI-allowed (default config)", () => {
        strict_1.default.deepEqual((0, context_js_1.resolveAllowedAddonIds)({}), []);
    });
    (0, node_test_1.it)("only lists addons that are BOTH enabled AND ai-allowed", () => {
        const ids = (0, context_js_1.resolveAllowedAddonIds)({
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            wallbox_enabled: false,
            wallbox_ai_optimization_allowed: true,
            battery_enabled: true,
            battery_ai_optimization_allowed: false,
        });
        strict_1.default.deepEqual(ids, ["immersion_heater"]);
    });
});
(0, node_test_1.describe)("ai buildAiOptimizationContext", () => {
    (0, node_test_1.it)("builds a compact digest without leaking full slot/allocation arrays", async () => {
        const host = {
            config: { immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true },
            async getStateAsync(id) {
                if (id === "policy.global.effective_json") {
                    return {
                        val: JSON.stringify({
                            limits: { houseFuseLimitW: { value: 30000 } },
                            economics: { gridImportAllowed: { value: true } },
                        }),
                        ack: true,
                    };
                }
                return null;
            },
        };
        const ctx = await (0, context_js_1.buildAiOptimizationContext)(host, minimalPlan(), "test_trigger");
        strict_1.default.deepEqual(ctx.allowedAddonIds, ["immersion_heater"]);
        strict_1.default.equal(ctx.dailyPlan.date, "2026-07-25");
        strict_1.default.equal(ctx.dailyPlan.totals.flexibleUnallocatedEnergyKwh, 1.2);
        strict_1.default.equal(ctx.policyHighlights.houseFuseLimitW, 30000);
        strict_1.default.equal(ctx.policyHighlights.gridImportAllowed, true);
        strict_1.default.equal(ctx.triggerReason, "test_trigger");
        strict_1.default.equal(ctx.slots, undefined);
    });
    (0, node_test_1.it)("missing/invalid policy state → empty highlights, never throws", async () => {
        const host = { config: {}, async getStateAsync() { return null; } };
        const ctx = await (0, context_js_1.buildAiOptimizationContext)(host, minimalPlan(), "x");
        strict_1.default.deepEqual(ctx.policyHighlights, { houseFuseLimitW: null, maxGridImportW: null, gridImportAllowed: null });
    });
});
