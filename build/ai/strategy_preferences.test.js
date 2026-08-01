"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const strategy_preferences_js_1 = require("./strategy_preferences.js");
/** Local noon Europe/Berlin ≈ 10:00Z in summer. */
const DAY1_A = "2026-07-25T10:00:00.000Z";
const DAY1_B = "2026-07-25T14:00:00.000Z";
const DAY2_A = "2026-07-26T08:00:00.000Z";
const DAY2_B = "2026-07-26T12:00:00.000Z";
const NOW_MS = Date.parse("2026-07-25T09:00:00.000Z");
function alloc(contributionId, startIso, powerW, extras = {}) {
    return {
        contributionId,
        contributor: { type: "addon", id: "wallbox", addonId: "wallbox" },
        slot: { startIso, endIso: startIso },
        status: "allocated",
        energySource: "grid",
        requestedPowerW: powerW,
        allocatedPowerW: powerW,
        requestedEnergyKwh: null,
        allocatedEnergyKwh: null,
        gridPowerW: powerW,
        pvPowerW: 0,
        mandatory: false,
        priorityRank: 1,
        deadlineIso: null,
        estimatedCostCt: null,
        reasonDe: "",
        ...extras,
    };
}
function slot(startIso, price, surplus, allocations = []) {
    return {
        slot: { startIso, endIso: startIso },
        pvForecastPowerW: surplus + 500,
        fixedHouseLoadPowerW: 400,
        fixedBalancePowerW: surplus,
        gridPriceCtPerKwh: price,
        gridImportAllowed: true,
        configuredGridImportLimitW: 30000,
        remainingGridImportPowerW: 20000,
        availablePvSurplusPowerW: surplus,
        allocatedFlexiblePowerW: 0,
        allocatedPvPowerW: 0,
        allocatedGridPowerW: 0,
        allocatedBatteryPowerW: 0,
        remainingPvSurplusPowerW: surplus,
        remainingGridImportPowerWAfterAlloc: 20000,
        remainingBatteryDischargePowerW: null,
        allocations,
        quality: { status: "valid", confidencePct: 100, reasonDe: "" },
        reasonDe: "",
    };
}
function tinyPlan(slots) {
    return {
        generatedAt: "2026-07-25T09:00:00.000Z",
        validUntil: null,
        revision: 1,
        date: "2026-07-25",
        timezone: "Europe/Berlin",
        slotMinutes: 15,
        globalMode: "balanced",
        status: "ready",
        policySnapshot: {},
        constraintSnapshot: {},
        activeContributionIds: ["wallbox.ev_session"],
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
        reasonDe: "test",
    };
}
(0, node_test_1.describe)("decisionsToSlotPreferences", () => {
    const plan = tinyPlan([
        slot(DAY1_A, 40, 100, [alloc("wallbox.ev_session", DAY1_A, 2000, { deadlineIso: "2026-07-26T18:00:00.000Z" })]),
        slot(DAY1_B, 10, 200),
        slot(DAY2_A, 25, 3000),
        slot(DAY2_B, 20, 500),
    ]);
    (0, node_test_1.it)("keep_plan_a emits no derived prefs", () => {
        const decisions = [
            { addonId: "wallbox", action: "keep_plan_a", note: "ok" },
        ];
        const prefs = (0, strategy_preferences_js_1.decisionsToSlotPreferences)(plan, decisions, [], NOW_MS);
        strict_1.default.equal(prefs.length, 0);
    });
    (0, node_test_1.it)("prefer_pv_tomorrow: high weight tomorrow surplus, low today", () => {
        const decisions = [
            { addonId: "wallbox", action: "prefer_pv_tomorrow", note: "PV morgen" },
        ];
        const prefs = (0, strategy_preferences_js_1.decisionsToSlotPreferences)(plan, decisions, [], NOW_MS);
        const byIso = new Map(prefs.map((p) => [p.slotStartIso, p.weight]));
        strict_1.default.ok((byIso.get(DAY1_A) ?? 1) < 1);
        strict_1.default.ok((byIso.get(DAY1_B) ?? 1) < 1);
        strict_1.default.ok((byIso.get(DAY2_A) ?? 0) >= 2.5);
    });
    (0, node_test_1.it)("prefer_pv_today: high weight on today's high surplus", () => {
        const decisions = [
            { addonId: "wallbox", action: "prefer_pv_today", note: "heute" },
        ];
        const prefs = (0, strategy_preferences_js_1.decisionsToSlotPreferences)(plan, decisions, [], NOW_MS);
        strict_1.default.ok(prefs.every((p) => p.slotStartIso === DAY1_A || p.slotStartIso === DAY1_B));
        const b = prefs.find((p) => p.slotStartIso === DAY1_B);
        strict_1.default.ok(b && b.weight >= 2.5);
    });
    (0, node_test_1.it)("charge_cheap_grid_now: prefers cheapest slot in next 12h", () => {
        const decisions = [
            { addonId: "wallbox", action: "charge_cheap_grid_now", note: "billig" },
        ];
        const prefs = (0, strategy_preferences_js_1.decisionsToSlotPreferences)(plan, decisions, [], NOW_MS);
        const cheap = prefs.find((p) => p.slotStartIso === DAY1_B);
        strict_1.default.ok(cheap && cheap.weight >= 2.5);
    });
    (0, node_test_1.it)("AI-provided prefs win on same slot+addon", () => {
        const decisions = [
            { addonId: "wallbox", action: "prefer_pv_today", note: "heute" },
        ];
        const existing = [
            { addonId: "wallbox", slotStartIso: DAY1_B, weight: 0.5 },
        ];
        const prefs = (0, strategy_preferences_js_1.decisionsToSlotPreferences)(plan, decisions, existing, NOW_MS);
        const b = prefs.find((p) => p.slotStartIso === DAY1_B);
        strict_1.default.equal(b?.weight, 0.5);
    });
    (0, node_test_1.it)("immersion defer_tomorrow lowers today", () => {
        const decisions = [
            { addonId: "immersion_heater", action: "defer_tomorrow", note: "morgen" },
        ];
        const prefs = (0, strategy_preferences_js_1.decisionsToSlotPreferences)(plan, decisions, [], NOW_MS);
        const today = prefs.find((p) => p.slotStartIso === DAY1_A);
        const tomorrow = prefs.find((p) => p.slotStartIso === DAY2_A);
        strict_1.default.ok(today && today.weight < 1);
        strict_1.default.ok(tomorrow && tomorrow.weight >= 2.5);
    });
    (0, node_test_1.it)("battery hold → weight 0.1 everywhere", () => {
        const decisions = [{ addonId: "battery", action: "hold", note: "warten" }];
        const prefs = (0, strategy_preferences_js_1.decisionsToSlotPreferences)(plan, decisions, [], NOW_MS);
        strict_1.default.equal(prefs.length, 4);
        strict_1.default.ok(prefs.every((p) => p.weight === 0.1));
    });
});
(0, node_test_1.describe)("wallboxPvOnlyFromDecisions", () => {
    (0, node_test_1.it)("true for prefer_pv_*", () => {
        strict_1.default.equal((0, strategy_preferences_js_1.wallboxPvOnlyFromDecisions)([{ addonId: "wallbox", action: "prefer_pv_today", note: "" }]), true);
        strict_1.default.equal((0, strategy_preferences_js_1.wallboxPvOnlyFromDecisions)([{ addonId: "wallbox", action: "prefer_pv_tomorrow", note: "" }]), true);
    });
    (0, node_test_1.it)("false otherwise", () => {
        strict_1.default.equal((0, strategy_preferences_js_1.wallboxPvOnlyFromDecisions)([{ addonId: "wallbox", action: "charge_cheap_grid_now", note: "" }]), false);
        strict_1.default.equal((0, strategy_preferences_js_1.wallboxPvOnlyFromDecisions)([]), false);
    });
});
(0, node_test_1.describe)("normalizeAddonDecisions", () => {
    const highSurplusSituation = {
        live: { pvPowerW: 2000, houseLoadW: 500, surplusW: 1500, deficitW: 0 },
        wallbox: {
            connected: true,
            charging: true,
            mode: "minpv",
            socPct: 40,
            remainingEnergyKwh: 7,
            effectiveLimitSoc: 80,
            planActive: true,
            deadlineIso: null,
        },
        immersion: { bufferTempC: 45, thermalEstimatedEmptyAt: null },
        climate: { units: [] },
        pvHorizon: [],
        pvTodayKwh: 30,
        pvTomorrowKwh: 12,
        priceNowCt: 25,
        priceAvg7d: 0.28,
        nextHours: {
            avgPvForecastPowerW: 2500,
            avgAvailablePvSurplusPowerW: 1200,
            minPriceCt: 12,
            maxPriceCt: 40,
        },
    };
    (0, node_test_1.it)("maps charge_cheap_grid_now + PV note → prefer_pv_today", () => {
        const out = (0, strategy_preferences_js_1.normalizeAddonDecisions)([{ addonId: "wallbox", action: "charge_cheap_grid_now", note: "PV-Überschuss hoch" }], highSurplusSituation);
        strict_1.default.equal(out[0]?.action, "prefer_pv_today");
        strict_1.default.equal((0, strategy_preferences_js_1.wallboxPvOnlyFromDecisions)(out), true);
    });
    (0, node_test_1.it)("keeps charge_cheap_grid_now when note is about price", () => {
        const out = (0, strategy_preferences_js_1.normalizeAddonDecisions)([{ addonId: "wallbox", action: "charge_cheap_grid_now", note: "Tibber günstig" }], {
            ...highSurplusSituation,
            nextHours: { ...highSurplusSituation.nextHours, avgAvailablePvSurplusPowerW: 50 },
        });
        strict_1.default.equal(out[0]?.action, "charge_cheap_grid_now");
    });
});
