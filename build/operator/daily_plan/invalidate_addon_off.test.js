"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const invalidate_addon_off_js_1 = require("./invalidate_addon_off.js");
const tick_js_1 = require("./tick.js");
const states_js_1 = require("./states.js");
const product_summary_js_1 = require("../../beta/product_summary.js");
(0, node_test_1.describe)("invalidate addon off — pure strip", () => {
    (0, node_test_1.it)("strips IH from unified and daily plan", () => {
        const unified = {
            allocations: [
                { kind: "immersion_heater", contributionId: "immersion_heater.flexible" },
                { kind: "climate", contributionId: "air_conditioning.unit_1" },
                { kind: "wallbox", contributionId: "wallbox.ev_session" },
            ],
            unallocated: [],
        };
        const stripped = (0, invalidate_addon_off_js_1.stripAddonFromUnifiedPlan)(unified, "immersion_heater");
        strict_1.default.equal(stripped.allocations.length, 2);
        strict_1.default.ok(!stripped.allocations.some((a) => a.kind === "immersion_heater"));
        const daily = {
            allocations: [
                { contributionId: "immersion_heater.flexible", allocatedPowerW: 1700 },
                { contributionId: "wallbox.ev_session", allocatedPowerW: 7000 },
            ],
            slots: [
                {
                    slot: { startIso: "a", endIso: "b" },
                    allocations: [
                        { contributionId: "immersion_heater.flexible", allocatedPowerW: 1700 },
                        { contributionId: "wallbox.ev_session", allocatedPowerW: 7000 },
                    ],
                },
            ],
        };
        const d2 = (0, invalidate_addon_off_js_1.stripAddonFromDailyPlan)(daily, "immersion_heater");
        strict_1.default.equal(d2.allocations.length, 1);
        strict_1.default.equal(d2.slots[0].allocations.length, 1);
        strict_1.default.equal((0, invalidate_addon_off_js_1.isAddonContributionId)("wallbox", "wallbox.ev_session"), true);
    });
});
(0, node_test_1.describe)("invalidatePublishedPlanForAddonOff — published states", () => {
    (0, node_test_1.it)("clears addon plan_json and product summary immediately", async () => {
        (0, tick_js_1.resetDailyPlanRevisionForTest)();
        const store = new Map();
        const plan = {
            allocations: [
                {
                    contributionId: "immersion_heater.flexible",
                    contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
                    slot: { startIso: "2026-08-09T11:00:00.000Z", endIso: "2026-08-09T11:15:00.000Z" },
                    status: "allocated",
                    energySource: "pv",
                    requestedPowerW: 1700,
                    allocatedPowerW: 1700,
                    requestedEnergyKwh: 0.4,
                    allocatedEnergyKwh: 0.4,
                    gridPowerW: 0,
                    pvPowerW: 1700,
                    batteryPowerW: 0,
                    mandatory: false,
                    priorityRank: null,
                    deadlineIso: null,
                    estimatedCostCt: null,
                    reasonDe: "test",
                },
                {
                    contributionId: "wallbox.ev_session",
                    contributor: { type: "addon", id: "wallbox", addonId: "wallbox" },
                    slot: { startIso: "2026-08-09T13:00:00.000Z", endIso: "2026-08-09T13:15:00.000Z" },
                    status: "allocated",
                    energySource: "pv",
                    requestedPowerW: 7000,
                    allocatedPowerW: 7000,
                    requestedEnergyKwh: 1.75,
                    allocatedEnergyKwh: 1.75,
                    gridPowerW: 0,
                    pvPowerW: 7000,
                    batteryPowerW: 0,
                    mandatory: false,
                    priorityRank: null,
                    deadlineIso: null,
                    estimatedCostCt: null,
                    reasonDe: "test",
                },
            ],
            slots: [],
        };
        store.set(states_js_1.DAILY_PLAN_STATE_IDS.planJson, JSON.stringify(plan));
        store.set(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson, JSON.stringify(plan.allocations.slice(0, 1)));
        store.set("global.execution_mode", "live");
        store.set("addons.immersion_heater.mode", "off");
        store.set("addons.wallbox.mode", "live");
        store.set("addons.battery.mode", "dryrun");
        store.set("addons.air_conditioning.mode", "live");
        store.set("operator.product_summary_de", "Plan: Heizstab thermisch vorladen 11:00–11:15.");
        const host = {
            config: {},
            log: { info: () => undefined, warn: () => undefined },
            getStateAsync: async (id) => store.has(id) ? { val: store.get(id), ack: true } : null,
            setStateAsync: async (id, st) => {
                store.set(id, st.val ?? null);
            },
        };
        await (0, tick_js_1.invalidatePublishedPlanForAddonOff)(host, "immersion_heater");
        strict_1.default.equal(store.get(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson), "[]");
        strict_1.default.match(String(store.get(states_js_1.ALLOCATION_ADDON_STATE_IDS.immersion_heater.reasonDe)), /AUS/);
        const stripped = JSON.parse(String(store.get(states_js_1.DAILY_PLAN_STATE_IDS.planJson)));
        strict_1.default.ok(!stripped.allocations.some((a) => a.contributionId.startsWith("immersion_heater.")));
        strict_1.default.ok(stripped.allocations.some((a) => a.contributionId.startsWith("wallbox.")));
        strict_1.default.match(String(store.get("operator.product_summary_de")), /AUS|Heizstab/);
        (0, tick_js_1.requestForcedUnifiedReplan)("test_after_invalidate");
    });
});
(0, node_test_1.describe)("OFF agenda — no stale allocation windows", () => {
    (0, node_test_1.it)("IH off agenda has AUS and no thermal window", () => {
        const plan = {
            schemaVersion: 1,
            planId: "stale",
            generation: 1,
            createdAtIso: "2026-08-09T06:00:00.000Z",
            date: "2026-08-09",
            timezone: "UTC",
            globalMode: "balanced",
            horizonStartIso: "2026-08-09T06:00:00.000Z",
            horizonEndIso: "2026-08-09T18:00:00.000Z",
            slotMinutes: 15,
            allocations: [
                {
                    kind: "immersion_heater",
                    contributionId: "immersion_heater.flexible",
                    slot: {
                        startIso: "2026-08-09T11:00:00.000Z",
                        endIso: "2026-08-09T11:15:00.000Z",
                    },
                    allocatedPowerW: 1700,
                    allocatedEnergyKwh: 0.4,
                    energySource: "pv",
                    reasonCodes: [],
                    constraintIds: [],
                },
                {
                    kind: "wallbox",
                    contributionId: "wallbox.ev_session",
                    slot: {
                        startIso: "2026-08-09T13:00:00.000Z",
                        endIso: "2026-08-09T13:15:00.000Z",
                    },
                    allocatedPowerW: 7000,
                    allocatedEnergyKwh: 1.75,
                    energySource: "pv",
                    reasonCodes: [],
                    constraintIds: [],
                },
            ],
            constraints: [],
            reasonCodes: [],
            unallocated: [],
            totals: {},
        };
        const afterStrip = (0, invalidate_addon_off_js_1.stripAddonFromUnifiedPlan)(plan, "immersion_heater");
        const agenda = (0, product_summary_js_1.buildUnifiedDayAgendaDe)(afterStrip, {
            immersion_heater: {
                liveWriteAllowed: false,
                hardwareActive: false,
                executionOff: true,
            },
            wallbox: {
                liveWriteAllowed: true,
                hardwareActive: false,
                executionOff: false,
            },
        });
        strict_1.default.ok(agenda.some((l) => /Heizstab: AUS/.test(l)));
        strict_1.default.ok(!agenda.some((l) => /thermisch vorladen|1700/.test(l)));
        strict_1.default.ok(agenda.some((l) => /Fahrzeugladung/.test(l)));
    });
});
