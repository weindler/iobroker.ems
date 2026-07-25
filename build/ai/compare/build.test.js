"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const build_js_1 = require("./build.js");
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
        gridPowerW: rest.gridPowerW ?? 0,
        pvPowerW: rest.pvPowerW ?? 0,
        mandatory: rest.mandatory ?? false,
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
        gridImportAllowed: overrides.gridImportAllowed ?? true,
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
function minimalPlan(slots) {
    return {
        generatedAt: "2026-07-25T09:00:00.000Z",
        validUntil: null,
        revision: 7,
        date: "2026-07-25",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: [],
        excludedContributions: [],
        slots,
        allocations: slots.flatMap((s) => s.allocations),
        unallocated: [],
        totals: {
            pvForecastEnergyKwh: null,
            fixedHouseLoadEnergyKwh: null,
            fixedRenewableBalanceKwh: null,
            flexibleRequestedEnergyKwh: null,
            flexibleAllocatedEnergyKwh: 0,
            flexibleUnallocatedEnergyKwh: 0.5,
            pvAllocatedEnergyKwh: 0,
            gridAllocatedEnergyKwh: 0,
            batteryChargeEnergyKwh: 0,
            wallboxEnergyKwh: 0,
            immersionHeaterEnergyKwh: 0,
            airConditioningEnergyKwh: 0,
            estimatedGridCostCt: null,
            mandatoryRequestedEnergyKwh: null,
            mandatoryAllocatedEnergyKwh: 0,
            mandatoryUnallocatedEnergyKwh: null,
        },
        quality: { status: "valid", confidencePct: 100, reasonDe: "" },
        reasonDe: "Testplan",
    };
}
(0, node_test_1.describe)("buildCompareResult", () => {
    (0, node_test_1.it)("no eligible add-on allowed → Plan B is identical to Plan A, activePlan=a", () => {
        const plan = minimalPlan([
            slot({
                startIso: T1,
                gridPriceCtPerKwh: 40,
                allocatedGridPowerW: 400,
                remainingGridImportPowerWAfterAlloc: 5000,
                allocations: [allocation({ contributionId: "immersion_heater.flexible", slotStart: T1, allocatedPowerW: 400, gridPowerW: 400 })],
            }),
        ]);
        const result = (0, build_js_1.buildCompareResult)(plan, [], []);
        strict_1.default.deepEqual(result.chartB, result.chartA);
        strict_1.default.equal(result.delta.activePlan, "a");
        strict_1.default.deepEqual(result.delta.aiInvolvedAddonIds, []);
        strict_1.default.equal(result.delta.deltaCostCt, 0);
    });
    (0, node_test_1.it)("without any AI slot preferences, Plan B reproduces Plan A even when the add-on is allowed", () => {
        const plan = minimalPlan([
            slot({
                startIso: T1,
                gridPriceCtPerKwh: 40,
                allocatedGridPowerW: 400,
                remainingGridImportPowerWAfterAlloc: 5000,
                allocations: [allocation({ contributionId: "immersion_heater.flexible", slotStart: T1, allocatedPowerW: 400, gridPowerW: 400 })],
            }),
            slot({
                startIso: T2,
                gridPriceCtPerKwh: 10,
                availablePvSurplusPowerW: 1000,
                remainingPvSurplusPowerW: 1000,
                remainingGridImportPowerWAfterAlloc: 5000,
            }),
        ]);
        const result = (0, build_js_1.buildCompareResult)(plan, ["immersion_heater"], []);
        strict_1.default.deepEqual(result.chartB, result.chartA);
        strict_1.default.equal(result.delta.activePlan, "a");
    });
    (0, node_test_1.it)("shifts flexible immersion-heater energy toward a cheap/PV-rich slot the AI prefers, lowering cost", () => {
        const plan = minimalPlan([
            slot({
                startIso: T1,
                gridPriceCtPerKwh: 40,
                allocatedGridPowerW: 400,
                remainingGridImportPowerWAfterAlloc: 5000,
                allocations: [allocation({ contributionId: "immersion_heater.flexible", slotStart: T1, allocatedPowerW: 400, gridPowerW: 400 })],
            }),
            slot({
                startIso: T2,
                gridPriceCtPerKwh: 10,
                availablePvSurplusPowerW: 1000,
                remainingPvSurplusPowerW: 1000,
                remainingGridImportPowerWAfterAlloc: 5000,
            }),
        ]);
        const slotPreferences = [
            { addonId: "immersion_heater", slotStartIso: T1, weight: 0.2 },
            { addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
        ];
        const result = (0, build_js_1.buildCompareResult)(plan, ["immersion_heater"], slotPreferences);
        // Energy conservation: total ih kWh must stay identical between A and B.
        strict_1.default.ok(Math.abs(result.delta.planA.ihKwh - result.delta.planB.ihKwh) < 1e-6);
        // Plan B must have moved meaningful energy into the cheaper/PV-rich slot.
        strict_1.default.ok(result.chartB[1].ihW > result.chartA[1].ihW);
        strict_1.default.ok(result.chartB[0].ihW < result.chartA[0].ihW);
        // Cheaper overall → Plan B wins.
        strict_1.default.ok(result.delta.planB.costCt < result.delta.planA.costCt);
        strict_1.default.equal(result.delta.activePlan, "b");
        strict_1.default.deepEqual(result.delta.aiInvolvedAddonIds, ["immersion_heater"]);
        // Unallocated flexible energy is untouched by a pure timing shift.
        strict_1.default.equal(result.delta.planA.unallocatedKwh, result.delta.planB.unallocatedKwh);
    });
    (0, node_test_1.it)("never touches mandatory allocations (e.g. anti-legionella) even with strong AI preferences elsewhere", () => {
        const plan = minimalPlan([
            slot({
                startIso: T1,
                gridPriceCtPerKwh: 40,
                allocatedGridPowerW: 200,
                remainingGridImportPowerWAfterAlloc: 5000,
                allocations: [
                    allocation({ contributionId: "immersion_heater.mandatory", slotStart: T1, allocatedPowerW: 200, gridPowerW: 200, mandatory: true }),
                ],
            }),
            slot({ startIso: T2, gridPriceCtPerKwh: 10, availablePvSurplusPowerW: 1000, remainingPvSurplusPowerW: 1000, remainingGridImportPowerWAfterAlloc: 5000 }),
        ]);
        const slotPreferences = [{ addonId: "immersion_heater", slotStartIso: T2, weight: 3 }];
        const result = (0, build_js_1.buildCompareResult)(plan, ["immersion_heater"], slotPreferences);
        strict_1.default.equal(result.chartA[0].ihW, 0);
        strict_1.default.equal(result.chartB[0].ihW, 0);
    });
});
