"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const run_js_1 = require("./run.js");
const ensure_states_js_1 = require("./ensure_states.js");
function minimalPlan() {
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
    };
}
function mockHost(config) {
    const store = new Map();
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
function fakeProvider(result) {
    return { id: "openai", async optimize() { return result; } };
}
const ALLOWED_CONFIG = {
    ai_enabled: true,
    ai_openai_api_key: "sk-test",
    ai_max_calls_per_day: 3,
    immersion_heater_enabled: true,
    immersion_heater_ai_optimization_allowed: true,
};
(0, node_test_1.describe)("runAiOptimizationNow — gating", () => {
    (0, node_test_1.it)("disabled globally → status off, provider never called", async () => {
        let called = false;
        const provider = fakeProvider({ ok: true, proposals: [], slotPreferences: [], reasonDe: "x", usage: { promptTokens: 1, completionTokens: 1 } });
        provider.optimize = async () => { called = true; return { ok: true, proposals: [], slotPreferences: [], reasonDe: "x", usage: { promptTokens: 1, completionTokens: 1 } }; };
        const host = mockHost({ ai_enabled: false });
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "test", provider);
        strict_1.default.equal(outcome.status, "off");
        strict_1.default.equal(outcome.ran, false);
        strict_1.default.equal(called, false);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.status), "off");
    });
    (0, node_test_1.it)("no token → status no_token, provider never called", async () => {
        let called = false;
        const provider = { id: "openai", async optimize() { called = true; return { ok: true, proposals: [], slotPreferences: [], reasonDe: "", usage: { promptTokens: null, completionTokens: null } }; } };
        const host = mockHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "test", provider);
        strict_1.default.equal(outcome.status, "no_token");
        strict_1.default.equal(called, false);
    });
    (0, node_test_1.it)("no addon allowed → status no_addons_allowed, provider never called", async () => {
        let called = false;
        const provider = { id: "openai", async optimize() { called = true; return { ok: true, proposals: [], slotPreferences: [], reasonDe: "", usage: { promptTokens: null, completionTokens: null } }; } };
        const host = mockHost({ ai_enabled: true, ai_openai_api_key: "sk-test" });
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "test", provider);
        strict_1.default.equal(outcome.status, "no_addons_allowed");
        strict_1.default.equal(called, false);
    });
    (0, node_test_1.it)("limit reached → status limit_reached, provider never called", async () => {
        let called = false;
        const provider = { id: "openai", async optimize() { called = true; return { ok: true, proposals: [], slotPreferences: [], reasonDe: "", usage: { promptTokens: null, completionTokens: null } }; } };
        const host = mockHost({ ...ALLOWED_CONFIG, ai_max_calls_per_day: 1 });
        host.store.set(ensure_states_js_1.AI_STATES.callsToday, 1);
        host.store.set(ensure_states_js_1.AI_STATES.callsTodayDate, new Date().toISOString().slice(0, 10));
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "test", provider);
        strict_1.default.equal(outcome.status, "limit_reached");
        strict_1.default.equal(called, false);
    });
});
(0, node_test_1.describe)("runAiOptimizationNow — successful/failed calls", () => {
    (0, node_test_1.it)("successful call without slot prefs → status ready, increments daily counter, writes cost", async () => {
        const provider = fakeProvider({
            ok: true,
            proposals: [{ addonId: "immersion_heater", note: "x" }],
            slotPreferences: [],
            reasonDe: "Alles gut.",
            usage: { promptTokens: 100, completionTokens: 50 },
        });
        const host = mockHost(ALLOWED_CONFIG);
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "new_daily_plan", provider);
        strict_1.default.equal(outcome.status, "ready");
        strict_1.default.equal(outcome.ran, true);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.callsToday), 1);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.lastRunResult), "ok");
        strict_1.default.ok(Number(host.store.get(ensure_states_js_1.AI_STATES.costEstimateTodayEur)) > 0);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.lastSlotPreferencesJson), "[]");
    });
    (0, node_test_1.it)("successful call with prefs that do not beat Plan A → suspended, prefs cleared", async () => {
        const provider = fakeProvider({
            ok: true,
            proposals: [{ addonId: "immersion_heater", note: "x" }],
            slotPreferences: [{ addonId: "immersion_heater", slotStartIso: "2026-07-25T10:00:00.000Z", weight: 2 }],
            reasonDe: "Alles gut.",
            usage: { promptTokens: 100, completionTokens: 50 },
        });
        const host = mockHost(ALLOWED_CONFIG);
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "new_daily_plan", provider);
        strict_1.default.equal(outcome.status, "suspended");
        strict_1.default.equal(outcome.ran, true);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.autoSuspended), true);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.lastSlotPreferencesJson), "[]");
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.callsToday), 1);
    });
    (0, node_test_1.it)("failed call → status error, still counts against the daily limit, clears slot preferences", async () => {
        const provider = fakeProvider({
            ok: false,
            proposals: [],
            slotPreferences: [],
            reasonDe: "Zeitüberschreitung.",
            usage: { promptTokens: null, completionTokens: null },
            error: "timeout",
        });
        const host = mockHost(ALLOWED_CONFIG);
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "manual", provider);
        strict_1.default.equal(outcome.status, "error");
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.callsToday), 1);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.lastError), "timeout");
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.lastSlotPreferencesJson), "[]");
    });
    (0, node_test_1.it)("provider throwing synchronously is caught and treated as a failed attempt", async () => {
        const provider = { id: "openai", async optimize() { throw new Error("boom"); } };
        const host = mockHost(ALLOWED_CONFIG);
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "manual", provider);
        strict_1.default.equal(outcome.status, "error");
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.callsToday), 1);
    });
});
