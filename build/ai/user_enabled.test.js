"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ensure_states_js_1 = require("./ensure_states.js");
const authority_js_1 = require("./writeback/authority.js");
const run_js_1 = require("./run.js");
const user_enabled_js_1 = require("./user_enabled.js");
function mockHost(config = {}) {
    const store = new Map();
    const host = {
        config,
        store,
        log: { debug() { }, warn() { }, error() { }, info() { } },
        async getStateAsync(id) {
            const val = store.get(id);
            return val === undefined ? null : { val, ack: true };
        },
        async setStateAsync(id, state) {
            store.set(id, state.val);
        },
    };
    return host;
}
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
const emptyOk = {
    ok: true,
    proposals: [],
    slotPreferences: [],
    thinkingDe: "",
    decisions: [],
    reasonDe: "ok",
    usage: { promptTokens: 1, completionTokens: 1 },
};
(0, node_test_1.describe)("ai.user_enabled migration + epoch (v0.1.258)", () => {
    (0, node_test_1.beforeEach)(() => {
        (0, user_enabled_js_1.resetAiEnableEpochForTest)();
    });
    (0, node_test_1.it)("A) migrates native.ai_enabled=true → user_enabled=true once", async () => {
        const host = mockHost({ ai_enabled: true });
        const r = await (0, user_enabled_js_1.migrateAiUserEnabledOnce)(host);
        strict_1.default.equal(r.ran, true);
        strict_1.default.equal(r.userEnabled, true);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.userEnabled), true);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.userEnabledMigratedV1), true);
    });
    (0, node_test_1.it)("B) migrates native.ai_enabled=false → user_enabled=false", async () => {
        const host = mockHost({ ai_enabled: false });
        const r = await (0, user_enabled_js_1.migrateAiUserEnabledOnce)(host);
        strict_1.default.equal(r.ran, true);
        strict_1.default.equal(r.userEnabled, false);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.userEnabled), false);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.status), "off");
    });
    (0, node_test_1.it)("C) migration runs only once — later native true does not re-enable", async () => {
        const host = mockHost({ ai_enabled: true });
        await (0, user_enabled_js_1.migrateAiUserEnabledOnce)(host);
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, false);
        host.config = { ai_enabled: true };
        const again = await (0, user_enabled_js_1.migrateAiUserEnabledOnce)(host);
        strict_1.default.equal(again.ran, false);
        strict_1.default.equal(again.userEnabled, false);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.userEnabled), false);
    });
    (0, node_test_1.it)("I) fresh install default user_enabled false when native missing", async () => {
        const host = mockHost({});
        const r = await (0, user_enabled_js_1.migrateAiUserEnabledOnce)(host);
        strict_1.default.equal(r.userEnabled, false);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.userEnabled), false);
    });
    (0, node_test_1.it)("E/F/G) OFF during request discards; OFF→ON does not revive old request", async () => {
        const host = mockHost({
            ai_openai_api_key: "sk-test",
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
        });
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, true);
        let release;
        const gate = new Promise((r) => {
            release = r;
        });
        const provider = {
            id: "openai",
            async optimize() {
                await gate;
                return emptyOk;
            },
        };
        const pending = (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "test", provider);
        await (0, user_enabled_js_1.applyAiUserEnabledToggle)(host, false);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.status), "off");
        await (0, user_enabled_js_1.applyAiUserEnabledToggle)(host, true);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.userEnabled), true);
        release();
        const outcome = await pending;
        strict_1.default.equal(outcome.ran, false);
        strict_1.default.match(outcome.reasonDe, /verworfen/i);
        strict_1.default.notEqual(host.store.get(ensure_states_js_1.AI_STATES.lastRunResult), "ok");
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.lastRunAt), undefined);
    });
    (0, node_test_1.it)("publish guard requires matching epoch and user_enabled", async () => {
        const host = mockHost({});
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, true);
        const epoch = (0, user_enabled_js_1.currentAiEnableEpoch)();
        strict_1.default.equal(await (0, user_enabled_js_1.isAiPublishAllowed)(host, epoch), true);
        (0, user_enabled_js_1.bumpAiEnableEpoch)();
        strict_1.default.equal(await (0, user_enabled_js_1.isAiPublishAllowed)(host, epoch), false);
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, false);
        strict_1.default.equal(await (0, user_enabled_js_1.isAiPublishAllowed)(host, (0, user_enabled_js_1.currentAiEnableEpoch)()), false);
    });
    (0, node_test_1.it)("toggle OFF sets status off without touching authority flag", async () => {
        const host = mockHost({});
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, true);
        host.store.set(ensure_states_js_1.AI_STATES.status, "ready");
        await (0, user_enabled_js_1.applyAiUserEnabledToggle)(host, false);
        strict_1.default.equal(await (0, user_enabled_js_1.readAiUserEnabled)(host), false);
        strict_1.default.equal(host.store.get(ensure_states_js_1.AI_STATES.status), "off");
        strict_1.default.equal(authority_js_1.AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
    });
    (0, node_test_1.it)("K) user_enabled true without API key → no_token, no provider call", async () => {
        let called = false;
        const host = mockHost({
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
        });
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, true);
        const provider = {
            id: "openai",
            async optimize() {
                called = true;
                return emptyOk;
            },
        };
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "test", provider);
        strict_1.default.equal(outcome.status, "no_token");
        strict_1.default.equal(called, false);
    });
    (0, node_test_1.it)("native.ai_enabled alone no longer enables runtime", async () => {
        let called = false;
        const host = mockHost({
            ai_enabled: true,
            ai_openai_api_key: "sk-test",
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
        });
        // migrated_v1 true, user_enabled false — native must be ignored
        host.store.set(ensure_states_js_1.AI_STATES.userEnabledMigratedV1, true);
        host.store.set(ensure_states_js_1.AI_STATES.userEnabled, false);
        const provider = {
            id: "openai",
            async optimize() {
                called = true;
                return emptyOk;
            },
        };
        const outcome = await (0, run_js_1.runAiOptimizationNow)(host, minimalPlan(), "test", provider);
        strict_1.default.equal(outcome.status, "off");
        strict_1.default.equal(called, false);
    });
});
