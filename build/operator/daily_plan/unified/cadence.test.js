"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../../quality");
const cadence_1 = require("./cadence");
const tick_1 = require("../tick");
const contribution_ids_1 = require("../../contribution_ids");
const types_1 = require("../../contributions/types");
const contributor_1 = require("../../contributor");
function planStub(overrides = {}) {
    const baseTotals = {
        pvForecastEnergyKwh: 18,
        fixedHouseLoadEnergyKwh: 12,
        fixedRenewableBalanceKwh: 6,
        flexibleRequestedEnergyKwh: 4,
        flexibleAllocatedEnergyKwh: 3,
        flexibleUnallocatedEnergyKwh: 1,
        pvAllocatedEnergyKwh: 3,
        gridAllocatedEnergyKwh: 0,
        batteryChargeEnergyKwh: 1,
        wallboxEnergyKwh: 0,
        immersionHeaterEnergyKwh: 2,
        airConditioningEnergyKwh: 0,
        estimatedGridCostCt: null,
        mandatoryRequestedEnergyKwh: null,
        mandatoryAllocatedEnergyKwh: 0,
        mandatoryUnallocatedEnergyKwh: null,
    };
    return {
        generatedAt: "2026-08-07T10:00:00.000Z",
        validUntil: null,
        revision: 1,
        date: "2026-08-07",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: ["immersion_heater.flexible", "battery.charge"],
        excludedContributions: [],
        slots: [
            {
                slot: { startIso: "2026-08-07T10:00:00.000Z", endIso: "2026-08-07T10:15:00.000Z" },
                pvForecastPowerW: 2000,
                fixedHouseLoadPowerW: 500,
                fixedBalancePowerW: 1500,
                gridPriceCtPerKwh: 20,
                gridImportAllowed: true,
                configuredGridImportLimitW: null,
                remainingGridImportPowerW: null,
                availablePvSurplusPowerW: 1500,
                allocatedFlexiblePowerW: 0,
                allocatedPvPowerW: 0,
                allocatedGridPowerW: 0,
                allocatedBatteryPowerW: 0,
                remainingPvSurplusPowerW: 1500,
                remainingGridImportPowerWAfterAlloc: null,
                remainingBatteryDischargePowerW: null,
                allocations: [],
                quality: (0, quality_1.operatorQuality)("valid", "t", 80),
                reasonDe: "t",
            },
        ],
        allocations: [],
        unallocated: [],
        totals: { ...baseTotals, ...overrides.totals },
        quality: (0, quality_1.operatorQuality)("valid", "t", 80),
        reasonDe: "t",
        ...overrides,
    };
}
(0, node_test_1.describe)("CADENCE-001 unchanged material → same digest", () => {
    (0, node_test_1.it)("two plans with only slot-roll / tiny allocation noise share digest", () => {
        const a = planStub();
        const b = planStub({
            generatedAt: "2026-08-07T10:01:00.000Z",
            revision: 2,
            slots: [
                {
                    ...planStub().slots[0],
                    slot: { startIso: "2026-08-07T10:15:00.000Z", endIso: "2026-08-07T10:30:00.000Z" },
                    allocatedFlexiblePowerW: 100,
                },
            ],
        });
        strict_1.default.equal((0, cadence_1.unifiedPlanCadenceDigest)(a), (0, cadence_1.unifiedPlanCadenceDigest)(b));
    });
});
(0, node_test_1.describe)("CADENCE-002 local day change", () => {
    (0, node_test_1.it)("date change yields new digest", () => {
        const a = planStub({ date: "2026-08-07" });
        const b = planStub({ date: "2026-08-08" });
        strict_1.default.notEqual((0, cadence_1.unifiedPlanCadenceDigest)(a), (0, cadence_1.unifiedPlanCadenceDigest)(b));
    });
});
(0, node_test_1.describe)("CADENCE-003 relevant forecast revision", () => {
    (0, node_test_1.it)("large PV day-energy change yields new digest", () => {
        const a = planStub({ totals: { ...planStub().totals, pvForecastEnergyKwh: 18 } });
        const b = planStub({ totals: { ...planStub().totals, pvForecastEnergyKwh: 28 } });
        strict_1.default.notEqual((0, cadence_1.unifiedPlanCadenceDigest)(a), (0, cadence_1.unifiedPlanCadenceDigest)(b));
    });
    (0, node_test_1.it)("wallbox family appearing (connected) yields new digest", () => {
        const a = planStub({ activeContributionIds: ["immersion_heater.flexible"] });
        const b = planStub({
            activeContributionIds: ["immersion_heater.flexible", "wallbox.ev_session"],
        });
        strict_1.default.notEqual((0, cadence_1.unifiedPlanCadenceDigest)(a), (0, cadence_1.unifiedPlanCadenceDigest)(b));
    });
});
(0, node_test_1.describe)("CADENCE-004 irrelevant telemetry / micro change", () => {
    (0, node_test_1.it)("sub-bucket flexible energy noise keeps digest", () => {
        const c = planStub({ totals: { ...planStub().totals, flexibleRequestedEnergyKwh: 4.05 } });
        const d = planStub({ totals: { ...planStub().totals, flexibleRequestedEnergyKwh: 4.14 } });
        strict_1.default.equal((0, cadence_1.unifiedPlanCadenceDigest)(c), (0, cadence_1.unifiedPlanCadenceDigest)(d));
    });
    (0, node_test_1.it)("price micro-change below median bucket keeps digest", () => {
        const base = planStub();
        const a = planStub({
            slots: [{ ...base.slots[0], gridPriceCtPerKwh: 20 }],
        });
        const b = planStub({
            slots: [{ ...base.slots[0], gridPriceCtPerKwh: 22 }],
        });
        strict_1.default.equal((0, cadence_1.unifiedPlanCadenceDigest)(a), (0, cadence_1.unifiedPlanCadenceDigest)(b));
    });
});
function mockHost() {
    const states = new Map();
    return {
        config: {
            intent_timezone: "UTC",
            bat_hw_max_charge_w: 5000,
            bat_hw_min_soc_pct: 10,
            bat_hw_max_soc_pct: 100,
        },
        log: { warn: () => { }, debug: () => { } },
        async getStateAsync(id) {
            if (!states.has(id))
                return null;
            return { val: states.get(id), ts: Date.now() };
        },
        async setStateAsync(id, state) {
            const val = state && typeof state === "object" && "val" in state
                ? state.val
                : state;
            states.set(id, val);
        },
        async getForeignStateAsync() {
            return null;
        },
    };
}
function forecastForTick(now, pvDayKwh) {
    const start = "2026-08-07T10:00:00.000Z";
    const end = "2026-08-07T10:15:00.000Z";
    return {
        generatedAt: now.toISOString(),
        validUntil: null,
        revision: 1,
        timezone: "UTC",
        horizonStart: start,
        horizonEnd: "2026-08-09T10:00:00.000Z",
        slotMinutes: 15,
        status: "ready",
        activeContributors: [],
        excludedContributors: [],
        days: [
            {
                date: "2026-08-07",
                pvEnergyKwh: pvDayKwh,
                houseLoadEnergyKwh: 10,
                renewableBalanceKwh: pvDayKwh - 10,
                weatherMinTempC: null,
                weatherMaxTempC: null,
                quality: (0, quality_1.operatorQuality)("valid", "OK"),
                reasonDe: "OK",
            },
        ],
        slots: [
            {
                slot: { startIso: start, endIso: end },
                pvPowerW: 3000,
                houseLoadPowerW: 500,
                fixedBalancePowerW: 2500,
                gridPriceCtPerKwh: 20,
                gridImportAllowed: true,
                gridMaxImportPowerW: 11000,
                outdoorTempC: null,
                quality: (0, quality_1.operatorQuality)("valid", "OK"),
                reasonDe: "OK",
            },
        ],
        contributions: [
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY, (0, types_1.pvContributorRef)(), "provide", ["supply"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: false,
                gridEligible: false,
                quality: (0, quality_1.operatorQuality)("valid", "PV", 80),
                reasonDe: "PV",
                details: {
                    correctedTodayKwh: pvDayKwh,
                    rawTodayKwh: pvDayKwh,
                    lastUpdateTs: now.toISOString(),
                    status: "ready",
                },
                slots: [],
            }),
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, (0, contributor_1.systemContributorRef)("house_load"), "consume", ["demand_fixed"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: false,
                gridEligible: false,
                quality: (0, quality_1.operatorQuality)("valid", "load", 70),
                reasonDe: "load",
                details: {},
                slots: [],
            }),
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY, (0, contributor_1.systemContributorRef)("grid_supply"), "provide", ["supply"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: false,
                gridEligible: true,
                quality: (0, quality_1.operatorQuality)("valid", "grid", 90),
                reasonDe: "grid",
                details: {},
                slots: [],
            }),
            (0, types_1.baseContribution)(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, (0, contributor_1.addonContributorRef)("battery"), "consume", ["storage"], {
                generatedAt: now.toISOString(),
                validUntil: null,
                revision: 1,
                enabled: true,
                flexible: true,
                gridEligible: false,
                quality: (0, quality_1.operatorQuality)("valid", "bat", 80),
                reasonDe: "bat",
                details: { socPct: 40, maxChargePowerW: 5000, requiredEnergyKwh: 2 },
                slots: [],
            }),
        ],
        quality: (0, quality_1.operatorQuality)("valid", "OK"),
        reasonDe: "OK",
    };
}
(0, node_test_1.describe)("CADENCE tick gate — no Unified regen without material change", () => {
    (0, node_test_1.it)("CADENCE-001: second tick without material change does not bump unified generation", async () => {
        (0, tick_1.resetDailyPlanRevisionForTest)();
        const host = mockHost();
        const now = new Date("2026-08-07T10:07:00.000Z");
        const fp = forecastForTick(now, 18);
        await (0, tick_1.runDailyPlanTick)(host, fp);
        const gen1 = (0, tick_1.unifiedPlanGenerationForTest)();
        strict_1.default.ok(gen1 >= 1);
        await (0, tick_1.runDailyPlanTick)(host, fp);
        strict_1.default.equal((0, tick_1.unifiedPlanGenerationForTest)(), gen1);
    });
    (0, node_test_1.it)("CADENCE-003 via tick: large PV change bumps unified generation", async () => {
        (0, tick_1.resetDailyPlanRevisionForTest)();
        const host = mockHost();
        const now = new Date("2026-08-07T10:07:00.000Z");
        await (0, tick_1.runDailyPlanTick)(host, forecastForTick(now, 18));
        const gen1 = (0, tick_1.unifiedPlanGenerationForTest)();
        await (0, tick_1.runDailyPlanTick)(host, forecastForTick(now, 30));
        strict_1.default.ok((0, tick_1.unifiedPlanGenerationForTest)() > gen1);
    });
});
