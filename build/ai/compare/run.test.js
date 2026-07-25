"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const run_js_1 = require("./run.js");
const ensure_states_js_1 = require("./ensure_states.js");
const ensure_states_js_2 = require("../ensure_states.js");
function minimalSlot(startIso, allocations = []) {
    return {
        slot: { startIso, endIso: startIso },
        pvForecastPowerW: null,
        fixedHouseLoadPowerW: null,
        fixedBalancePowerW: null,
        gridPriceCtPerKwh: 30,
        gridImportAllowed: true,
        configuredGridImportLimitW: 30000,
        remainingGridImportPowerW: 20000,
        availablePvSurplusPowerW: 0,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: 0,
        allocatedGridPowerW: allocations.reduce((s, a) => s + (a.gridPowerW ?? 0), 0),
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: 0,
        remainingGridImportPowerWAfterAlloc: 20000,
        remainingBatteryDischargePowerW: null,
        allocations,
        quality: { status: "valid", confidencePct: 100, reasonDe: "" },
        reasonDe: "",
    };
}
function minimalPlan() {
    const slots = [minimalSlot("2026-07-25T10:00:00.000Z")];
    return {
        generatedAt: "2026-07-25T09:00:00.000Z",
        validUntil: null,
        revision: 3,
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
        allocations: [],
        unallocated: [],
        totals: {
            pvForecastEnergyKwh: null,
            fixedHouseLoadEnergyKwh: null,
            fixedRenewableBalanceKwh: null,
            flexibleRequestedEnergyKwh: null,
            flexibleAllocatedEnergyKwh: 0,
            flexibleUnallocatedEnergyKwh: null,
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
function mockHost(config, initialStates = {}) {
    const store = new Map(Object.entries(initialStates));
    return {
        config,
        store,
        async getStateAsync(id) {
            const v = store.get(id);
            return v === undefined ? null : { val: v, ack: true };
        },
        async setStateAsync(id, state) {
            store.set(id, state.val);
        },
    };
}
(0, node_test_1.describe)("runPlanCompare", () => {
    (0, node_test_1.it)("writes all compare.* states, defaults to activePlan=a when nothing is AI-allowed", async () => {
        const host = mockHost({});
        const result = await (0, run_js_1.runPlanCompare)(host, minimalPlan());
        strict_1.default.equal(host.store.get(ensure_states_js_1.COMPARE_STATES.activePlan), "a");
        strict_1.default.equal(host.store.get(ensure_states_js_1.COMPARE_STATES.planRevision), 3);
        strict_1.default.equal(typeof host.store.get(ensure_states_js_1.COMPARE_STATES.planAChartJson), "string");
        strict_1.default.equal(typeof host.store.get(ensure_states_js_1.COMPARE_STATES.planBChartJson), "string");
        strict_1.default.equal(typeof host.store.get(ensure_states_js_1.COMPARE_STATES.deltaSummaryJson), "string");
        strict_1.default.equal(result.delta.activePlan, "a");
    });
    (0, node_test_1.it)("ignores malformed ai.last_slot_preferences_json instead of throwing", async () => {
        const host = mockHost({ immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true }, { [ensure_states_js_2.AI_STATES.lastSlotPreferencesJson]: "not json" });
        const result = await (0, run_js_1.runPlanCompare)(host, minimalPlan());
        strict_1.default.equal(result.delta.activePlan, "a");
    });
    (0, node_test_1.it)("reads valid ai.last_slot_preferences_json and feeds it into the comparison", async () => {
        const slotPrefs = [{ addonId: "immersion_heater", slotStartIso: "2026-07-25T10:00:00.000Z", weight: 2 }];
        const host = mockHost({ immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true }, { [ensure_states_js_2.AI_STATES.lastSlotPreferencesJson]: JSON.stringify(slotPrefs) });
        const result = await (0, run_js_1.runPlanCompare)(host, minimalPlan());
        strict_1.default.deepEqual(result.delta.aiInvolvedAddonIds, ["immersion_heater"]);
    });
});
