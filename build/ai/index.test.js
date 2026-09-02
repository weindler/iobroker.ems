"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
const ensure_states_js_1 = require("./ensure_states.js");
const states_js_1 = require("../operator/daily_plan/states.js");
(0, node_test_1.describe)("ai state change routing", () => {
    (0, node_test_1.it)("isAiRelatedState matches optimize-now, user_enabled and daily-analyst run_now", () => {
        strict_1.default.equal((0, index_js_1.isAiRelatedState)(ensure_states_js_1.AI_STATES.optimizeNowRequest), true);
        strict_1.default.equal((0, index_js_1.isAiRelatedState)(ensure_states_js_1.AI_STATES.userEnabled), true);
        strict_1.default.equal((0, index_js_1.isAiRelatedState)("ai.daily_analyst.run_now_request"), true);
        strict_1.default.equal((0, index_js_1.isAiRelatedState)("ai.status"), false);
        strict_1.default.equal((0, index_js_1.isAiRelatedState)("backup.export_request"), false);
    });
    (0, node_test_1.it)("behandelt optimize_now_request bei ack=true und ack=false; val!=true ohne Lauf", async () => {
        const store = new Map();
        const host = {
            config: {},
            log: { debug() { }, warn() { }, error() { } },
            async getStateAsync(id) {
                const v = store.get(id);
                return v === undefined ? null : { val: v, ack: true };
            },
            async setStateAsync(id, state) {
                store.set(id, state.val);
            },
        };
        const handledAckTrue = await (0, index_js_1.handleAiStateChange)(host, ensure_states_js_1.AI_STATES.optimizeNowRequest, true, true);
        strict_1.default.equal(handledAckTrue, true);
        strict_1.default.equal(store.get(ensure_states_js_1.AI_STATES.optimizeNowRequest), false);
        strict_1.default.equal(store.get(ensure_states_js_1.AI_STATES.lastReasonDe), "Kein aktueller Daily Plan vorhanden.");
        const handledFalseVal = await (0, index_js_1.handleAiStateChange)(host, ensure_states_js_1.AI_STATES.optimizeNowRequest, false, false);
        strict_1.default.equal(handledFalseVal, true);
        const handledOther = await (0, index_js_1.handleAiStateChange)(host, "ai.status", true, false);
        strict_1.default.equal(handledOther, false);
    });
    (0, node_test_1.it)("val=true/ack=false → resets button and attempts a run (fail-closed: no plan → no throw)", async () => {
        const store = new Map();
        const host = {
            config: {},
            log: { debug() { }, warn() { }, error() { } },
            async getStateAsync(id) {
                const v = store.get(id);
                return v === undefined ? null : { val: v, ack: true };
            },
            async setStateAsync(id, state) {
                store.set(id, state.val);
            },
        };
        const handled = await (0, index_js_1.handleAiStateChange)(host, ensure_states_js_1.AI_STATES.optimizeNowRequest, true, false);
        strict_1.default.equal(handled, true);
        strict_1.default.equal(store.get(ensure_states_js_1.AI_STATES.optimizeNowRequest), false);
        // no daily plan present in the mock host → runAiOptimizationManual resolves without throwing
        strict_1.default.equal(store.get(states_js_1.DAILY_PLAN_STATE_IDS.planJson), undefined);
    });
    (0, node_test_1.it)("clears a leftover optimize_now_request=true without running", async () => {
        const store = new Map();
        store.set(ensure_states_js_1.AI_STATES.optimizeNowRequest, true);
        const host = {
            async getStateAsync(id) {
                const v = store.get(id);
                return v === undefined ? null : { val: v, ack: false };
            },
            async setStateAsync(id, state) {
                store.set(id, state.val);
            },
        };
        const cleared = await (0, index_js_1.clearStaleAiOptimizeNowRequest)(host);
        strict_1.default.equal(cleared, true);
        strict_1.default.equal(store.get(ensure_states_js_1.AI_STATES.optimizeNowRequest), false);
    });
    (0, node_test_1.it)("daily_analyst.run_now_request val=true mit ack=true oder ack=false wird behandelt", async () => {
        const store = new Map();
        const host = {
            config: { ai_analyst_mode: "disabled" },
            log: { debug() { }, warn() { }, error() { } },
            getAbsolutePath: () => "/tmp/ems-analyst-state-test",
            async getStateAsync(id) {
                const v = store.get(id);
                return v === undefined ? null : { val: v, ack: true };
            },
            async setStateAsync(id, state) {
                store.set(id, state.val);
            },
        };
        const handledAckFalse = await (0, index_js_1.handleAiStateChange)(host, "ai.daily_analyst.run_now_request", true, false);
        strict_1.default.equal(handledAckFalse, true);
        const handledAckTrue = await (0, index_js_1.handleAiStateChange)(host, "ai.daily_analyst.run_now_request", true, true);
        strict_1.default.equal(handledAckTrue, true);
        const handledReset = await (0, index_js_1.handleAiStateChange)(host, "ai.daily_analyst.run_now_request", false, true);
        strict_1.default.equal(handledReset, true);
    });
});
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
        ...overrides,
    };
}
function mockRunHost(config) {
    const store = new Map();
    if (config.ai_enabled === true) {
        store.set(ensure_states_js_1.AI_STATES.userEnabled, true);
    }
    return {
        config,
        store,
        log: { debug() { }, warn() { }, error() { } },
        async getStateAsync(id) {
            const val = store.get(id);
            return val === undefined ? null : { val, ack: true };
        },
        async setStateAsync(id, state) {
            store.set(id, state.val);
        },
    };
}
// Mindestabstand explizit deaktiviert (0), damit diese Tests ausschließlich das Digest-Verhalten
// prüfen — der Mindestabstand selbst hat eine eigene describe-Gruppe weiter unten.
const NO_INTERVAL = { ai_min_interval_minutes: 0 };
(0, node_test_1.describe)("maybeTriggerAiOptimizationOnDailyPlanChange — digest-based throttling", () => {
    (0, node_test_1.it)("does not trigger again when only revision/slots change but the coarse digest stays equal", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({
            ai_enabled: true,
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            ...NO_INTERVAL,
        });
        const first = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ revision: 1 }));
        strict_1.default.ok(first !== null);
        strict_1.default.equal(first?.status, "no_token");
        const second = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ revision: 2, slots: [] }));
        strict_1.default.equal(second, null);
    });
    (0, node_test_1.it)("does not trigger again when only allocation progress changes but demand digest stays equal", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({
            ai_enabled: true,
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            ...NO_INTERVAL,
        });
        const baseTotals = {
            ...minimalPlan().totals,
            flexibleRequestedEnergyKwh: 5,
        };
        const first = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...baseTotals, flexibleAllocatedEnergyKwh: 0.5, flexibleUnallocatedEnergyKwh: 4.5 } }));
        strict_1.default.ok(first !== null);
        const second = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({
            revision: 99,
            totals: { ...baseTotals, flexibleAllocatedEnergyKwh: 2.4, flexibleUnallocatedEnergyKwh: 2.6 },
        }));
        strict_1.default.equal(second, null);
    });
    (0, node_test_1.it)("triggers again once the coarse digest changes (e.g. flexible demand jumps by more than one bucket)", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({
            ai_enabled: true,
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            ...NO_INTERVAL,
        });
        const first = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }));
        strict_1.default.ok(first !== null);
        const second = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }));
        strict_1.default.ok(second !== null);
    });
    (0, node_test_1.it)("while disabled, tracks the digest so re-enabling with the same unchanged plan doesn't immediately fire", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            ...NO_INTERVAL,
        });
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, false);
        const plan = minimalPlan({ revision: 1 });
        const whileDisabled = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, plan);
        strict_1.default.equal(whileDisabled, null);
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, true);
        const afterEnableUnchanged = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, plan);
        strict_1.default.equal(afterEnableUnchanged, null);
        const afterEnableChanged = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }));
        strict_1.default.ok(afterEnableChanged !== null);
    });
    (0, node_test_1.it)("user_enabled toggle via state change bumps epoch and sets status off", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const store = new Map();
        store.set(ensure_states_js_1.AI_STATES.userEnabled, true);
        store.set(ensure_states_js_1.AI_STATES.status, "ready");
        const host = {
            config: {},
            log: { debug() { }, warn() { }, error() { }, info() { } },
            async getStateAsync(id) {
                const v = store.get(id);
                return v === undefined ? null : { val: v, ack: true };
            },
            async setStateAsync(id, state) {
                store.set(id, state.val);
            },
        };
        const handled = await (0, index_js_1.handleAiStateChange)(host, ensure_states_js_1.AI_STATES.userEnabled, false, false);
        strict_1.default.equal(handled, true);
        strict_1.default.equal(store.get(ensure_states_js_1.AI_STATES.userEnabled), false);
        strict_1.default.equal(store.get(ensure_states_js_1.AI_STATES.status), "off");
    });
});
(0, node_test_1.describe)("maybeTriggerAiOptimizationOnDailyPlanChange — minimum interval throttling (v0.1.196)", () => {
    (0, node_test_1.it)("fires immediately on the very first automatic trigger even with the default 60min interval", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
        const t0 = new Date("2026-07-26T08:00:00.000Z");
        const first = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ revision: 1 }), t0);
        strict_1.default.ok(first !== null);
    });
    (0, node_test_1.it)("suppresses a second digest change within the interval, then fires once the interval has elapsed", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
        const t0 = new Date("2026-07-26T08:00:00.000Z");
        const first = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }), t0);
        strict_1.default.ok(first !== null);
        // digest changed again, but only 10 minutes later — well within the 60min default interval.
        const t1 = new Date("2026-07-26T08:10:00.000Z");
        const blocked = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }), t1);
        strict_1.default.equal(blocked, null);
        // still within the interval and digest unchanged from t1's plan → stays blocked.
        const t2 = new Date("2026-07-26T08:30:00.000Z");
        const stillBlocked = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }), t2);
        strict_1.default.equal(stillBlocked, null);
        // interval elapsed (61 minutes after t0) → fires with the now-current plan.
        const t3 = new Date("2026-07-26T09:01:00.000Z");
        const fired = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }), t3);
        strict_1.default.ok(fired !== null);
    });
    (0, node_test_1.it)("respects a custom configured interval (e.g. 30 minutes)", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({
            ai_enabled: true,
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            ai_min_interval_minutes: 30,
        });
        const t0 = new Date("2026-07-26T08:00:00.000Z");
        await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }), t0);
        const t1 = new Date("2026-07-26T08:29:00.000Z");
        const blocked = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }), t1);
        strict_1.default.equal(blocked, null);
        const t2 = new Date("2026-07-26T08:31:00.000Z");
        const fired = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }), t2);
        strict_1.default.ok(fired !== null);
    });
    (0, node_test_1.it)("with interval disabled (0), behaves exactly like pure digest-based throttling", async () => {
        (0, index_js_1.resetAiPipelineHookForTest)();
        const host = mockRunHost({
            ai_enabled: true,
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            ...NO_INTERVAL,
        });
        const t0 = new Date("2026-07-26T08:00:00.000Z");
        const first = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }), t0);
        strict_1.default.ok(first !== null);
        const t1 = new Date("2026-07-26T08:00:01.000Z");
        const fired = await (0, index_js_1.maybeTriggerAiOptimizationOnDailyPlanChange)(host, minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }), t1);
        strict_1.default.ok(fired !== null);
    });
});
