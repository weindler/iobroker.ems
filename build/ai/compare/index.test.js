"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
function planWithRevision(revision) {
    return {
        generatedAt: "2026-07-25T09:00:00.000Z",
        validUntil: null,
        revision,
        date: "2026-07-25",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: [],
        excludedContributions: [],
        slots: [],
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
function mockHost() {
    const store = new Map();
    return {
        config: {},
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
(0, node_test_1.describe)("maybeUpdatePlanCompareOnDailyPlanChange", () => {
    (0, node_test_1.it)("runs on the first revision it sees, then skips repeats of the same revision", async () => {
        (0, index_js_1.resetPlanCompareHookForTest)();
        const host = mockHost();
        const first = await (0, index_js_1.maybeUpdatePlanCompareOnDailyPlanChange)(host, planWithRevision(1));
        strict_1.default.ok(first);
        const repeat = await (0, index_js_1.maybeUpdatePlanCompareOnDailyPlanChange)(host, planWithRevision(1));
        strict_1.default.equal(repeat, null);
        const second = await (0, index_js_1.maybeUpdatePlanCompareOnDailyPlanChange)(host, planWithRevision(2));
        strict_1.default.ok(second);
    });
});
