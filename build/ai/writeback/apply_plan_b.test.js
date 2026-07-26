"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const apply_plan_b_js_1 = require("./apply_plan_b.js");
const build_js_1 = require("../compare/build.js");
const T1 = "2026-07-25T10:00:00.000Z";
const T2 = "2026-07-25T10:15:00.000Z";
function allocation(overrides) {
    const { slotStart, ...rest } = overrides;
    return {
        contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
        slot: { startIso: slotStart, endIso: slotStart },
        status: "allocated",
        energySource: "grid",
        requestedPowerW: rest.allocatedPowerW ?? 0,
        allocatedPowerW: rest.allocatedPowerW ?? 0,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: null,
        gridPowerW: rest.gridPowerW ?? rest.allocatedPowerW ?? 0,
        pvPowerW: rest.pvPowerW ?? 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "",
        ...rest,
    };
}
function slot(overrides) {
    const allocations = overrides.allocations ?? [];
    return {
        slot: { startIso: overrides.startIso, endIso: overrides.startIso },
        pvForecastPowerW: null,
        fixedHouseLoadPowerW: null,
        fixedBalancePowerW: null,
        gridPriceCtPerKwh: overrides.gridPriceCtPerKwh ?? 30,
        gridImportAllowed: true,
        configuredGridImportLimitW: 30000,
        remainingGridImportPowerW: 20000,
        availablePvSurplusPowerW: overrides.availablePvSurplusPowerW ?? 0,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: overrides.allocatedPvPowerW ?? 0,
        allocatedGridPowerW: overrides.allocatedGridPowerW ?? 0,
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: overrides.remainingPvSurplusPowerW ?? 0,
        remainingGridImportPowerWAfterAlloc: overrides.remainingGridImportPowerWAfterAlloc ?? 20000,
        remainingBatteryDischargePowerW: null,
        allocations,
        quality: { status: "valid", confidencePct: 100, reasonDe: "" },
        reasonDe: "",
        ...overrides,
    };
}
function plan(slots) {
    return {
        generatedAt: "2026-07-25T09:00:00.000Z",
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
        excludedContributions: [],
        slots,
        allocations: slots.flatMap((s) => s.allocations),
        unallocated: [],
        totals: {
            pvForecastEnergyKwh: null,
            fixedHouseLoadEnergyKwh: null,
            fixedRenewableBalanceKwh: null,
            flexibleRequestedEnergyKwh: 1,
            flexibleAllocatedEnergyKwh: 1,
            flexibleUnallocatedEnergyKwh: 0,
            pvAllocatedEnergyKwh: 0,
            gridAllocatedEnergyKwh: 1,
            batteryChargeEnergyKwh: 0,
            wallboxEnergyKwh: 0,
            immersionHeaterEnergyKwh: 1,
            airConditioningEnergyKwh: 0,
            estimatedGridCostCt: 40,
            mandatoryRequestedEnergyKwh: null,
            mandatoryAllocatedEnergyKwh: 0,
            mandatoryUnallocatedEnergyKwh: null,
        },
        quality: { status: "valid", confidencePct: 100, reasonDe: "" },
        reasonDe: "Plan A",
    };
}
(0, node_test_1.describe)("planBBeatsPlanA", () => {
    (0, node_test_1.it)("wins on lower cost", () => {
        strict_1.default.equal((0, build_js_1.planBBeatsPlanA)({ deltaCostCt: -1, deltaGridKwh: 0, deltaPvKwh: 0 }), true);
    });
    (0, node_test_1.it)("loses on higher cost even with better PV", () => {
        strict_1.default.equal((0, build_js_1.planBBeatsPlanA)({ deltaCostCt: 1, deltaGridKwh: -1, deltaPvKwh: 2 }), false);
    });
    (0, node_test_1.it)("wins on equal cost with lower grid", () => {
        strict_1.default.equal((0, build_js_1.planBBeatsPlanA)({ deltaCostCt: 0, deltaGridKwh: -0.1, deltaPvKwh: 0 }), true);
    });
});
(0, node_test_1.describe)("applyAiPreferencesToDailyPlan", () => {
    (0, node_test_1.it)("applies write-back when shifting load to cheaper/PV slot", () => {
        const p = plan([
            slot({
                startIso: T1,
                gridPriceCtPerKwh: 40,
                allocatedGridPowerW: 2000,
                remainingGridImportPowerWAfterAlloc: 5000,
                allocations: [
                    allocation({
                        contributionId: "immersion_heater.flexible",
                        slotStart: T1,
                        allocatedPowerW: 2000,
                        gridPowerW: 2000,
                    }),
                ],
            }),
            slot({
                startIso: T2,
                gridPriceCtPerKwh: 10,
                availablePvSurplusPowerW: 3000,
                remainingPvSurplusPowerW: 3000,
                remainingGridImportPowerWAfterAlloc: 5000,
            }),
        ]);
        const prefs = [
            { addonId: "immersion_heater", slotStartIso: T1, weight: 0.1 },
            { addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
        ];
        const r = (0, apply_plan_b_js_1.applyAiPreferencesToDailyPlan)(p, ["immersion_heater"], prefs);
        strict_1.default.equal(r.writebackApplied, true);
        strict_1.default.equal(r.compare.delta.activePlan, "b");
        strict_1.default.match(r.plan.reasonDe, /KI Plan B/);
        const ih1 = r.plan.slots[0].allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
        const ih2 = r.plan.slots[1].allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
        strict_1.default.ok((ih1?.allocatedPowerW ?? 0) < 2000);
        strict_1.default.ok((ih2?.allocatedPowerW ?? 0) > 0);
    });
    (0, node_test_1.it)("does not write-back when preferences empty", () => {
        const p = plan([slot({ startIso: T1, allocations: [] })]);
        const r = (0, apply_plan_b_js_1.applyAiPreferencesToDailyPlan)(p, ["immersion_heater"], []);
        strict_1.default.equal(r.writebackApplied, false);
        strict_1.default.equal(r.plan.reasonDe, "Plan A");
    });
});
