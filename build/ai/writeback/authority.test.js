"use strict";
/**
 * AI-AUTH-001…006 — Beta Authority Boundary.
 * AI darf keine autoritativen Allocations/Slices mutieren; Learning schon.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const ensure_states_1 = require("../ensure_states");
const ensure_states_2 = require("../compare/ensure_states");
const apply_plan_b_1 = require("./apply_plan_b");
const authority_1 = require("./authority");
const index_1 = require("./index");
const daily_persist_1 = require("../../learning/pv_bias/daily_persist");
const T1 = "2026-08-08T10:00:00.000Z";
const T2 = "2026-08-08T10:15:00.000Z";
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
        generatedAt: "2026-08-08T09:00:00.000Z",
        validUntil: null,
        revision: 1,
        date: "2026-08-08",
        timezone: "UTC",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: ["immersion_heater.flexible", "battery.charge", "wallbox.ev_session"],
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
function expensiveCheapPair(contribId, powerW, contributor) {
    return plan([
        slot({
            startIso: T1,
            gridPriceCtPerKwh: 40,
            allocatedGridPowerW: powerW,
            remainingGridImportPowerWAfterAlloc: 5000,
            allocations: [
                allocation({
                    contributionId: contribId,
                    slotStart: T1,
                    allocatedPowerW: powerW,
                    gridPowerW: powerW,
                    contributor,
                    deadlineIso: contribId.startsWith("wallbox") ? "2026-08-09T06:00:00.000Z" : null,
                }),
            ],
        }),
        slot({
            startIso: T2,
            gridPriceCtPerKwh: 10,
            availablePvSurplusPowerW: 4000,
            remainingPvSurplusPowerW: 4000,
            remainingGridImportPowerWAfterAlloc: 5000,
        }),
    ]);
}
function mockHost(prefs) {
    const states = new Map([
        [ensure_states_1.AI_STATES.lastSlotPreferencesJson, JSON.stringify(prefs)],
        [ensure_states_1.AI_STATES.lastDecisionsJson, "[]"],
        [ensure_states_1.AI_STATES.autoSuspended, false],
    ]);
    const host = {
        states,
        republishHits: 0,
        config: {
            immersion_heater_enabled: true,
            immersion_heater_ai_optimization_allowed: true,
            air_conditioning_enabled: true,
            air_conditioning_ai_optimization_allowed: true,
            battery_enabled: true,
            battery_ai_optimization_allowed: true,
            wallbox_enabled: true,
            wallbox_ai_optimization_allowed: true,
        },
        async getStateAsync(id) {
            if (!states.has(id))
                return null;
            return {
                val: states.get(id),
                ack: true,
                ts: Date.now(),
                lc: Date.now(),
                from: "test",
            };
        },
        async setStateAsync(id, state) {
            const val = state && typeof state === "object" && "val" in state
                ? state.val
                : state;
            states.set(id, val);
            if (id.includes("allocations_json") ||
                id.includes("daily_plan.plan_json") ||
                id.includes("allocation.battery") ||
                id.includes("allocation.wallbox")) {
                host.republishHits += 1;
            }
            return undefined;
        },
        log: { warn: () => { } },
    };
    return host;
}
(0, node_test_1.describe)("AI Authority Boundary (beta)", () => {
    (0, node_test_1.it)("gate flag disables live allocation mutation", () => {
        strict_1.default.equal(authority_1.AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
    });
});
(0, node_test_1.describe)("AI-AUTH-001 battery slice not mutated by AI gate", () => {
    (0, node_test_1.it)("Plan-B-preferred battery prefs do not change authoritative battery.charge", async () => {
        const p = expensiveCheapPair("battery.charge", 1000, {
            type: "addon",
            id: "battery",
            addonId: "battery",
        });
        const prefs = [
            { addonId: "battery", slotStartIso: T1, weight: 0.1 },
            { addonId: "battery", slotStartIso: T2, weight: 3 },
        ];
        const sim = (0, apply_plan_b_1.applyAiPreferencesToDailyPlan)(p, ["battery"], prefs);
        strict_1.default.equal(sim.compare.delta.activePlan, "b");
        const host = mockHost(prefs);
        const before = JSON.stringify(p.allocations);
        const out = await (0, index_1.maybeApplyAiWritebackOnDailyPlan)(host, p);
        strict_1.default.equal(JSON.stringify(out.allocations), before);
        const bat1 = out.slots[0].allocations.find((a) => a.contributionId === "battery.charge");
        strict_1.default.equal(bat1?.allocatedPowerW, 1000);
        strict_1.default.equal(out.reasonDe.includes("KI Plan B aktiv"), false);
        const fin = await (0, index_1.finalizeAiRunWithWritebackGate)(host, p, prefs, { skipAutoSuspend: true });
        strict_1.default.equal(fin.writebackApplied, false);
        strict_1.default.equal(fin.planBPreferred, true);
        strict_1.default.equal(fin.advisory.mutatesAllocations, false);
        strict_1.default.equal(host.republishHits, 0);
    });
});
(0, node_test_1.describe)("AI-AUTH-002 wallbox window stays unified-authoritative", () => {
    (0, node_test_1.it)("EV window prefs do not mutate wallbox.ev_session via gate", async () => {
        const p = expensiveCheapPair("wallbox.ev_session", 3000, {
            type: "addon",
            id: "wallbox",
            addonId: "wallbox",
        });
        const prefs = [
            { addonId: "wallbox", slotStartIso: T1, weight: 0.1 },
            { addonId: "wallbox", slotStartIso: T2, weight: 3 },
        ];
        strict_1.default.equal((0, apply_plan_b_1.applyAiPreferencesToDailyPlan)(p, ["wallbox"], prefs).compare.delta.activePlan, "b");
        const out = await (0, index_1.maybeApplyAiWritebackOnDailyPlan)(mockHost(prefs), p);
        const wb1 = out.slots[0].allocations.find((a) => a.contributionId === "wallbox.ev_session");
        const wb2 = out.slots[1].allocations.find((a) => a.contributionId === "wallbox.ev_session");
        strict_1.default.equal(wb1?.allocatedPowerW, 3000);
        strict_1.default.equal(wb2?.allocatedPowerW ?? 0, 0);
    });
});
(0, node_test_1.describe)("AI-AUTH-003 IH/AC windows no direct mutation", () => {
    (0, node_test_1.it)("IH prefs do not mutate immersion allocations via gate", async () => {
        const p = expensiveCheapPair("immersion_heater.flexible", 2000, {
            type: "addon",
            id: "immersion_heater",
            addonId: "immersion_heater",
        });
        const prefs = [
            { addonId: "immersion_heater", slotStartIso: T1, weight: 0.1 },
            { addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
        ];
        strict_1.default.equal((0, apply_plan_b_1.applyAiPreferencesToDailyPlan)(p, ["immersion_heater"], prefs).compare.delta.activePlan, "b");
        const out = await (0, index_1.maybeApplyAiWritebackOnDailyPlan)(mockHost(prefs), p);
        const ih1 = out.slots[0].allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
        const ih2 = out.slots[1].allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
        strict_1.default.equal(ih1?.allocatedPowerW, 2000);
        strict_1.default.equal(ih2?.allocatedPowerW ?? 0, 0);
    });
});
(0, node_test_1.describe)("AI-AUTH-004 advisory recommendation available", () => {
    (0, node_test_1.it)("Plan B advisory remains without authority change", async () => {
        const p = expensiveCheapPair("immersion_heater.flexible", 2000, {
            type: "addon",
            id: "immersion_heater",
            addonId: "immersion_heater",
        });
        const prefs = [
            { addonId: "immersion_heater", slotStartIso: T1, weight: 0.1 },
            { addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
        ];
        const host = mockHost(prefs);
        const before = JSON.stringify(p);
        const fin = await (0, index_1.finalizeAiRunWithWritebackGate)(host, p, prefs, { skipAutoSuspend: true });
        strict_1.default.equal(fin.writebackApplied, false);
        strict_1.default.equal(fin.planBPreferred, true);
        strict_1.default.ok(fin.advisory);
        strict_1.default.equal(fin.advisory.mutatesLiveSlices, false);
        strict_1.default.match(fin.advisory.decisionReasonDe, /advisory/i);
        strict_1.default.equal(JSON.stringify(p), before);
        const advisory = (0, authority_1.buildPlanBAdvisory)(fin.compare);
        strict_1.default.equal(advisory.planBPreferred, true);
        strict_1.default.equal(host.states.get(ensure_states_2.COMPARE_STATES.activePlan), "b");
    });
});
(0, node_test_1.describe)("AI-AUTH-005 AI unavailable", () => {
    (0, node_test_1.it)("empty prefs → plan unchanged, no mutation", async () => {
        const p = expensiveCheapPair("battery.charge", 1000, {
            type: "addon",
            id: "battery",
            addonId: "battery",
        });
        const before = JSON.stringify(p.allocations);
        const out = await (0, index_1.maybeApplyAiWritebackOnDailyPlan)(mockHost([]), p);
        strict_1.default.equal(JSON.stringify(out.allocations), before);
        const fin = await (0, index_1.finalizeAiRunWithWritebackGate)(mockHost([]), p, [], { skipAutoSuspend: true });
        strict_1.default.equal(fin.writebackApplied, false);
        strict_1.default.equal(fin.planBPreferred, false);
        strict_1.default.equal(fin.suspended, false);
    });
});
(0, node_test_1.describe)("AI-AUTH-006 Learning → Unified input still active", () => {
    (0, node_test_1.it)("PV bias daily upsert from evaluation path remains writable", () => {
        const persist = (0, daily_persist_1.emptyDailyPersist)();
        const next = (0, daily_persist_1.upsertDailyRecord)(persist, {
            date: "2026-08-07",
            actualKwh: 12,
            actualCapturedAt: "2026-08-07T22:00:00.000Z",
            forecastKwh: 18,
            forecastCapturedAt: "2026-08-07T06:00:00.000Z",
            actualSource: "day_evaluation",
            forecastSource: "day_evaluation_initial_plan",
        });
        strict_1.default.equal(next.days["2026-08-07"]?.forecastKwh, 18);
        strict_1.default.equal(next.days["2026-08-07"]?.actualKwh, 12);
        strict_1.default.notEqual(next.days["2026-08-07"]?.forecastKwh, next.days["2026-08-07"]?.actualKwh);
        strict_1.default.equal(authority_1.AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
    });
});
