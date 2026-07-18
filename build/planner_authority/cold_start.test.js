"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const states_js_1 = require("./states.js");
const runtime_js_1 = require("./runtime.js");
const runtime_session_js_1 = require("./runtime_session.js");
const project_intent_js_1 = require("./project_intent.js");
const states_js_2 = require("../operator/daily_plan/states.js");
function memoryHost(config = {}) {
    const objects = new Map();
    const states = new Map();
    const order = [];
    return {
        namespace: "ems.0",
        config,
        log: { debug() { }, info() { }, warn() { }, error() { } },
        objects,
        states,
        order,
        durableDataDir: "/tmp/ems-authority-cold/ems.0",
        async setObjectNotExistsAsync(id, obj) {
            order.push(`object:${id}`);
            if (!objects.has(id))
                objects.set(id, obj);
            const common = obj?.common;
            if (common?.type) {
                states.set(id, { val: states.get(id)?.val, type: common.type });
            }
        },
        async getStateAsync(id) {
            const cur = states.get(id);
            return cur && cur.val !== undefined ? { val: cur.val, ack: true } : null;
        },
        async setStateAsync(id, st) {
            order.push(`state:${id}`);
            const v = st && typeof st === "object" && st !== null && "val" in st ? st.val : st;
            const prev = states.get(id);
            states.set(id, { val: v, type: prev?.type });
        },
        async extendObjectAsync() { },
        async subscribeStatesAsync() { },
        async unsubscribeStatesAsync() { },
    };
}
(0, node_test_1.describe)("planner_authority cold start", () => {
    (0, node_test_1.it)("creates authority objects before the first state write", async () => {
        (0, runtime_session_js_1.resetAuthoritySessionForTest)();
        const host = memoryHost({ planner_authoritative_source: "legacy" });
        await (0, runtime_js_1.initPlannerAuthorityRuntime)(host);
        const firstObject = host.order.findIndex((e) => e.startsWith("object:"));
        const firstState = host.order.findIndex((e) => e.startsWith("state:"));
        strict_1.default.ok(firstObject >= 0);
        strict_1.default.ok(firstState >= 0);
        strict_1.default.ok(firstObject < firstState);
        strict_1.default.ok(host.objects.has(states_js_1.PLANNER_AUTHORITY_STATE_IDS.configuredSource));
        await (0, runtime_js_1.stopPlannerAuthorityRuntime)();
    });
    (0, node_test_1.it)("writes only numbers into numeric memory and daily-plan allocation meta states", async () => {
        const host = memoryHost();
        await (0, states_js_1.ensurePlannerAuthorityStates)(host);
        await (0, states_js_1.writePlannerAuthorityMemoryStates)(host, {
            rssBeforeWorkerJobMib: 100,
            rssAfterWorkerExitMib: 120,
            lastWorkerDeltaMib: 20,
            legacyModuleLoaded: false,
        });
        strict_1.default.equal(typeof host.states.get(states_js_1.PLANNER_AUTHORITY_STATE_IDS.rssBeforeWorkerJobMib)?.val, "number");
        strict_1.default.equal(typeof host.states.get(states_js_1.PLANNER_AUTHORITY_STATE_IDS.rssAfterWorkerExitMib)?.val, "number");
        strict_1.default.equal(typeof host.states.get(states_js_1.PLANNER_AUTHORITY_STATE_IDS.lastWorkerDeltaMib)?.val, "number");
        const view = {
            source: "worker_dryrun",
            quality: "valid",
            generation: 3,
            planRevision: "rev-test",
            loadedAt: "2026-07-15T10:05:00.000Z",
            currentSlot: {
                slotStart: "2026-07-15T10:00:00.000Z",
                slotEnd: "2026-07-15T10:15:00.000Z",
                allocations: [
                    {
                        contributionId: "battery.charge",
                        status: "allocated",
                        powerW: 1000,
                        energyKwh: 0.25,
                    },
                ],
            },
            nextSlot: null,
        };
        await (0, project_intent_js_1.projectWorkerViewToIntentStates)(host, {
            view,
            now: new Date("2026-07-15T10:05:00.000Z"),
            timezone: "Europe/Berlin",
            globalMode: "balanced",
            slotMinutes: 15,
        });
        strict_1.default.equal(typeof host.states.get(states_js_2.DAILY_PLAN_STATE_IDS.slotMinutes)?.val, "number");
        strict_1.default.equal(typeof host.states.get(states_js_2.DAILY_PLAN_STATE_IDS.revision)?.val, "number");
        strict_1.default.notEqual(typeof host.states.get(states_js_2.DAILY_PLAN_STATE_IDS.slotMinutes)?.val, "string");
        strict_1.default.notEqual(typeof host.states.get(states_js_2.DAILY_PLAN_STATE_IDS.revision)?.val, "string");
    });
});
