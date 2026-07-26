"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const quality_1 = require("../quality");
const contributor_1 = require("../contributor");
const contribution_ids_1 = require("../contribution_ids");
const types_1 = require("../contributions/types");
const policy_1 = require("./policy");
const constraints_1 = require("./constraints");
const slots_1 = require("./slots");
const allocation_1 = require("./allocation");
const build_1 = require("./build");
const constraints_2 = require("./constraints");
const build_2 = require("../forecast/build");
const pv_1 = require("../contributions/pv");
const house_load_1 = require("../contributions/house_load");
const weather_1 = require("../contributions/weather");
const constraints_3 = require("../contributions/constraints");
const NOW = new Date("2026-07-11T10:07:00.000Z");
const TZ = "UTC";
function flexContribution(contributionId, addonId, overrides = {}) {
    const { details = {}, ...rest } = overrides;
    return (0, types_1.baseContribution)(contributionId, (0, contributor_1.addonContributorRef)(addonId), "consume", ["demand_flex"], {
        generatedAt: NOW.toISOString(),
        validUntil: null,
        revision: 1,
        enabled: true,
        flexible: true,
        gridEligible: true,
        quality: (0, quality_1.operatorQuality)("valid", "OK"),
        reasonDe: "OK",
        details,
        slots: [],
        ...rest,
    });
}
function forecastSlot(startIso, endIso, opts = {}) {
    const pv = opts.pv ?? null;
    const load = opts.load ?? null;
    const balance = pv !== null && load !== null ? pv - load : null;
    return {
        slot: { startIso, endIso },
        pvPowerW: pv,
        houseLoadPowerW: load,
        fixedBalancePowerW: balance,
        gridPriceCtPerKwh: opts.price ?? null,
        gridImportAllowed: opts.importAllowed ?? true,
        gridMaxImportPowerW: 11000,
        outdoorTempC: null,
        quality: (0, quality_1.operatorQuality)("valid", "OK"),
        reasonDe: "test",
    };
}
function minimalForecast(overrides = {}) {
    return {
        generatedAt: NOW.toISOString(),
        validUntil: null,
        revision: 1,
        timezone: TZ,
        horizonStart: NOW.toISOString(),
        horizonEnd: "2026-07-12T00:00:00.000Z",
        slotMinutes: 15,
        status: "ready",
        activeContributors: [],
        excludedContributors: [],
        days: [
            {
                date: "2026-07-11",
                pvEnergyKwh: 20,
                houseLoadEnergyKwh: 10,
                renewableBalanceKwh: 10,
                weatherMinTempC: null,
                weatherMaxTempC: null,
                quality: (0, quality_1.operatorQuality)("valid", "OK"),
                reasonDe: "OK",
            },
        ],
        slots: [],
        contributions: [],
        quality: (0, quality_1.operatorQuality)("valid", "OK"),
        reasonDe: "OK",
        ...overrides,
    };
}
(0, node_test_1.describe)("daily plan policy", () => {
    (0, node_test_1.it)("matches contribution id before addon id in priority", () => {
        const order = (0, policy_1.policyOrderFor)("immersion_heater.mandatory", "immersion_heater", ["wallbox", "immersion_heater.mandatory", "battery"]);
        strict_1.default.equal(order, 1);
    });
    (0, node_test_1.it)("uses alphabetical tie-breaker via compareAllocationCandidates", () => {
        const a = (0, policy_1.buildAllocationCandidate)(flexContribution("battery.charge", "battery"), "balanced", []);
        const b = (0, policy_1.buildAllocationCandidate)(flexContribution("wallbox.ev_session", "wallbox"), "balanced", []);
        strict_1.default.ok((0, policy_1.compareAllocationCandidates)(a, b) < 0);
    });
    (0, node_test_1.it)("detects mutual exclusion pairs", () => {
        strict_1.default.ok((0, policy_1.isMutualExclusionPair)("battery", "wallbox", [{ addonA: "battery", addonB: "wallbox" }]));
    });
    (0, node_test_1.it)("matches policy refs", () => {
        strict_1.default.ok((0, policy_1.matchesPolicyRef)("battery.charge", "battery.charge", "battery"));
        strict_1.default.ok((0, policy_1.matchesPolicyRef)("battery", "battery.charge", "battery"));
    });
});
(0, node_test_1.describe)("daily plan constraints", () => {
    (0, node_test_1.it)("computes pv surplus only when balance positive", () => {
        strict_1.default.equal((0, constraints_1.availablePvSurplus)(3000), 3000);
        strict_1.default.equal((0, constraints_1.availablePvSurplus)(-500), 0);
        strict_1.default.equal((0, constraints_1.availablePvSurplus)(null), null);
    });
    (0, node_test_1.it)("remaining grid import subtracts house load", () => {
        strict_1.default.equal((0, constraints_1.remainingGridImportForSlot)(11000, 3000), 8000);
    });
    (0, node_test_1.it)("returns null grid remaining when house load unknown", () => {
        strict_1.default.equal((0, constraints_1.remainingGridImportForSlot)(11000, null), null);
    });
    (0, node_test_1.it)("effective import limit uses minimum of limits", () => {
        strict_1.default.equal((0, constraints_1.effectiveImportLimitW)(11000, 9000), 9000);
    });
});
(0, node_test_1.describe)("daily plan end-to-end: PV shape + house-load segments reach Daily Plan slots", () => {
    (0, node_test_1.it)("regression: pvForecastPowerW/fixedHouseLoadPowerW are no longer null once PV shape + house-load segments are configured", () => {
        const now = new Date("2026-07-11T10:00:00.000Z");
        const tz = "UTC";
        const pv = (0, pv_1.buildPvContribution)({
            now,
            correctedTodayKwh: 15,
            correctedTomorrowKwh: 18,
            rawTodayKwh: 14,
            rawTomorrowKwh: 17,
            confidencePct: 80,
            status: "ready",
            lastUpdateTs: now.toISOString(),
            source: "learning.pv_bias",
            horizonDays: [
                { dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 15, confidencePct: 80 },
                { dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 18, confidencePct: 80 },
            ],
            shape: { timezone: tz, latDeg: 48.14, lonDeg: 11.58, hourlyPoints: [], capW: null },
        });
        const house = (0, house_load_1.buildHouseLoadContribution)({
            now,
            timezone: tz,
            status: "ready",
            confidence: 70,
            forecastToday: {
                date: "2026-07-11",
                season: "summer",
                weekday: "saturday",
                day_type: "weekend",
                segments: {
                    midday: { avg_w: 800, source: "p", fallback_level: "none", confidence: 70 },
                    afternoon: { avg_w: 600, source: "p", fallback_level: "none", confidence: 70 },
                    evening: { avg_w: 400, source: "p", fallback_level: "none", confidence: 70 },
                },
            },
            forecastTomorrow: null,
            lastUpdate: now.toISOString(),
        });
        const weather = (0, weather_1.buildWeatherContribution)({
            now,
            learningStatus: "ready",
            learningHealth: "ok",
            confidencePct: 90,
            lastUpdate: now.toISOString(),
            forecastSource: "test",
            actualSource: "test",
            outdoorTempC: 22,
            cloudPct: 10,
            hourlyPoints: [],
            todayMinTempC: 18,
            todayMaxTempC: 24,
            tomorrowMinTempC: null,
            tomorrowMaxTempC: null,
            forecastHorizonStart: now.toISOString(),
            forecastHorizonEnd: null,
        });
        const grid = (0, constraints_3.buildGridSupplyContribution)({
            generatedAt: now.toISOString(),
            validUntil: null,
            source: "dynamic_tariff",
            currentPriceCtPerKwh: 24,
            gridImportAllowed: true,
            configuredMaxGridImportW: 11000,
            configuredHouseFuseLimitW: 13800,
            effectiveMaxGridImportW: 11000,
            slots: [
                {
                    startIso: "2026-07-11T10:00:00.000Z",
                    endIso: "2026-07-11T10:15:00.000Z",
                    priceCtPerKwh: 20,
                    importAllowed: true,
                    maxImportPowerW: 11000,
                    priceLabel: "normal",
                    quality: (0, quality_1.operatorQuality)("valid", "OK"),
                },
            ],
            quality: (0, quality_1.operatorQuality)("valid", "Grid OK"),
            reasonDe: "Grid OK",
        });
        const forecastPlan = (0, build_2.buildForecastPlan)({ now, timezone: tz, contributions: [pv, house, weather, grid] });
        strict_1.default.equal(forecastPlan.status, "ready");
        const plan = (0, build_1.buildDailyPlanFromForecast)(now, tz, "balanced", forecastPlan, {
            policySnapshot: null,
            energyPriority: [],
            mutualExclusions: [],
            gridImportAllowedPolicy: true,
            effectiveMaxGridImportW: 11000,
            configuredHouseFuseLimitW: 13800,
            modePolicy: { mode: "balanced", allowOptimization: true },
        });
        const firstSlot = plan.slots[0];
        strict_1.default.equal(firstSlot.slot.startIso, "2026-07-11T10:00:00.000Z");
        strict_1.default.notEqual(firstSlot.pvForecastPowerW, null);
        strict_1.default.notEqual(firstSlot.fixedHouseLoadPowerW, null);
        strict_1.default.equal(firstSlot.fixedHouseLoadPowerW, 800);
        strict_1.default.notEqual(firstSlot.fixedBalancePowerW, null);
        strict_1.default.notEqual(firstSlot.availablePvSurplusPowerW, null);
        strict_1.default.equal(plan.slots.length, slots_1.DAILY_PLAN_HORIZON_HOURS * 4);
        strict_1.default.equal(plan.validUntil, "2026-07-13T10:00:00.000Z");
        // Segmente gelten für den konfigurierten Tag (heute); rollierender 48h-Horizont
        // enthält Folgetage ohne Hauslast-Segmente in diesem Fixture → nur Tag 0 prüfen.
        for (const s of plan.slots.filter((x) => x.slot.startIso.startsWith("2026-07-11"))) {
            const hourUtc = new Date(s.slot.startIso).getUTCHours();
            const expected = hourUtc < 14 ? 800 : hourUtc < 18 ? 600 : 400;
            strict_1.default.equal(s.fixedHouseLoadPowerW, expected, `slot ${s.slot.startIso} should inherit its segment value`);
        }
    });
});
(0, node_test_1.describe)("daily plan forecast merge across resolutions", () => {
    const hourStart = "2026-07-11T06:00:00.000Z";
    const q1Start = "2026-07-11T06:00:00.000Z";
    const q1End = "2026-07-11T06:15:00.000Z";
    const q2Start = "2026-07-11T06:15:00.000Z";
    const q2End = "2026-07-11T06:30:00.000Z";
    const q3Start = "2026-07-11T06:30:00.000Z";
    const q3End = "2026-07-11T06:45:00.000Z";
    const q4Start = "2026-07-11T06:45:00.000Z";
    const q4End = "2026-07-11T07:00:00.000Z";
    const hourEnd = q4End;
    (0, node_test_1.it)("projects a multi-hour house-load segment onto every contained 15-min slot", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([
            { startIso: q1Start, endIso: q1End },
            { startIso: q2Start, endIso: q2End },
            { startIso: q3Start, endIso: q3End },
            { startIso: q4Start, endIso: q4End },
        ], [
            // 4h segment baseline (e.g. house-load learning), does not align with 15-min keys
            forecastSlot(hourStart, hourEnd, { load: 500 }),
            // exact 15-min price slot only for the first quarter (e.g. grid supply)
            forecastSlot(q1Start, q1End, { price: 25 }),
        ], 11000, 13800);
        strict_1.default.equal(slots.length, 4);
        for (const s of slots) {
            strict_1.default.equal(s.fixedHouseLoadPowerW, 500, `expected house load in slot ${s.slot.startIso}`);
        }
        strict_1.default.equal(slots[0].gridPriceCtPerKwh, 25);
        strict_1.default.equal(slots[1].gridPriceCtPerKwh, null);
        strict_1.default.equal(slots[2].gridPriceCtPerKwh, null);
        strict_1.default.equal(slots[3].gridPriceCtPerKwh, null);
    });
    (0, node_test_1.it)("does not leak a segment's value onto slots outside its window", () => {
        const outsideStart = "2026-07-11T07:00:00.000Z";
        const outsideEnd = "2026-07-11T07:15:00.000Z";
        const slots = (0, constraints_2.buildDailyPlanSlots)([{ startIso: outsideStart, endIso: outsideEnd }], [forecastSlot(hourStart, hourEnd, { load: 500 })], 11000, 13800);
        strict_1.default.equal(slots[0].fixedHouseLoadPowerW, null);
    });
    (0, node_test_1.it)("still computes fixedBalancePowerW when pv and house load come from different-resolution sources", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([{ startIso: q1Start, endIso: q1End }], [
            forecastSlot(hourStart, hourEnd, { load: 500 }),
            forecastSlot(q1Start, q1End, { pv: 2000 }),
        ], 11000, 13800);
        strict_1.default.equal(slots[0].pvForecastPowerW, 2000);
        strict_1.default.equal(slots[0].fixedHouseLoadPowerW, 500);
        strict_1.default.equal(slots[0].fixedBalancePowerW, 1500);
        strict_1.default.equal(slots[0].availablePvSurplusPowerW, 1500);
    });
    (0, node_test_1.it)("prefers the more precise (smaller) overlapping slot when sources overlap", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([{ startIso: q1Start, endIso: q1End }], [
            forecastSlot(hourStart, hourEnd, { load: 500 }),
            forecastSlot(q1Start, q1End, { load: 640 }),
        ], 11000, 13800);
        strict_1.default.equal(slots[0].fixedHouseLoadPowerW, 640);
    });
});
(0, node_test_1.describe)("daily plan slots", () => {
    (0, node_test_1.it)("floors to 15 minute boundary", () => {
        strict_1.default.equal((0, slots_1.slotStartIsoFloored)(NOW, TZ), "2026-07-11T10:00:00.000Z");
    });
    (0, node_test_1.it)("builds rolling horizon of at least 48 hours (Block 5)", () => {
        const slots = (0, slots_1.buildDailyHorizonSlots)(NOW, TZ, 15);
        strict_1.default.ok(slots.length > 0);
        strict_1.default.equal(slots[0].startIso, "2026-07-11T10:00:00.000Z");
        strict_1.default.equal(slots[slots.length - 1].endIso, "2026-07-13T10:00:00.000Z");
        strict_1.default.equal(slots.length, slots_1.DAILY_PLAN_HORIZON_HOURS * 4);
    });
});
(0, node_test_1.describe)("daily plan allocation", () => {
    const slot1Start = "2026-07-11T10:00:00.000Z";
    const slot1End = "2026-07-11T10:15:00.000Z";
    const slot2Start = "2026-07-11T10:15:00.000Z";
    const slot2End = "2026-07-11T10:30:00.000Z";
    (0, node_test_1.it)("allocates battery charge from pv surplus", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([
            { startIso: slot1Start, endIso: slot1End },
            { startIso: slot2Start, endIso: slot2End },
        ], [
            forecastSlot(slot1Start, slot1End, { pv: 5000, load: 1000, price: 20 }),
            forecastSlot(slot2Start, slot2End, { pv: 4000, load: 1000, price: 30 }),
        ], 11000, 13800);
        const battery = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, "battery", {
            details: { requiredEnergyKwh: 2 },
            slots: [{ slot: { startIso: slot1Start, endIso: slot1End }, maxPowerW: 5000, requiredEnergyKwh: 2, available: true, mandatory: false, minPowerW: null, preferredPowerW: null, availableEnergyKwh: null, priceCtPerKwh: null, quality: (0, quality_1.operatorQuality)("valid", "OK") }],
        }), "balanced", ["battery"]);
        const result = (0, allocation_1.runAllocation)({
            slots,
            candidates: [battery],
            globalMode: "balanced",
            modeAllowsOptimization: true,
            gridImportAllowedPolicy: true,
            mutualExclusions: [],
            nowMs: NOW.getTime(),
        });
        strict_1.default.ok(result.allocations.length > 0);
        strict_1.default.ok(result.allocations.some((a) => a.energySource === "pv_surplus"));
    });
    (0, node_test_1.it)("excludes disconnected wallbox without error", () => {
        const c = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, "wallbox", {
            enabled: false,
            quality: (0, quality_1.operatorQuality)("disabled", "Fahrzeug nicht verbunden."),
        }), "balanced", []);
        strict_1.default.equal(c.allocatable, false);
    });
    (0, node_test_1.it)("excludes unsupported battery discharge", () => {
        const c = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_DISCHARGE, "battery", {
            flow: "provide",
            enabled: false,
            quality: (0, quality_1.operatorQuality)("unsupported", "unsupported"),
        }), "balanced", []);
        strict_1.default.equal(c.allocationStatus, "unsupported");
    });
    (0, node_test_1.it)("respects mutual exclusion for grid in same slot", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([{ startIso: slot1Start, endIso: slot1End }], [forecastSlot(slot1Start, slot1End, { pv: 0, load: 1000, price: 10 })], 11000, 13800);
        const battery = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, "battery", {
            details: { requiredEnergyKwh: 1 },
        }), "balanced", ["battery", "wallbox"]);
        const wallbox = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.WALLBOX_EV_SESSION, "wallbox", {
            details: { requiredEnergyKwh: 1 },
        }), "balanced", ["battery", "wallbox"]);
        const result = (0, allocation_1.runAllocation)({
            slots,
            candidates: [battery, wallbox],
            globalMode: "balanced",
            modeAllowsOptimization: true,
            gridImportAllowedPolicy: true,
            mutualExclusions: [{ id: "x", addonA: "battery", addonB: "wallbox" }],
            nowMs: NOW.getTime(),
        });
        const gridInSlot = result.allocations.filter((a) => a.slot.startIso === slot1Start && a.gridPowerW > 0);
        strict_1.default.ok(gridInSlot.length <= 1);
    });
    (0, node_test_1.it)("global mode off documents mandatory without allocation", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([{ startIso: slot1Start, endIso: slot1End }], [forecastSlot(slot1Start, slot1End, { pv: 5000, load: 1000 })], 11000, 13800);
        const mandatory = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_MANDATORY, "immersion_heater", {
            details: { requiredEnergyKwh: 3, mandatory: true },
        }), "off", []);
        mandatory.mandatory = true;
        const result = (0, allocation_1.runAllocation)({
            slots,
            candidates: [mandatory],
            globalMode: "off",
            modeAllowsOptimization: false,
            gridImportAllowedPolicy: true,
            mutualExclusions: [],
            nowMs: NOW.getTime(),
        });
        strict_1.default.equal(result.allocations.length, 0);
        strict_1.default.ok(result.unallocated.length > 0);
    });
    (0, node_test_1.it)("immersion flexible pv-first gets no grid", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([{ startIso: slot1Start, endIso: slot1End }], [forecastSlot(slot1Start, slot1End, { pv: 0, load: 1000, price: 5 })], 11000, 13800);
        const flex = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
            gridEligible: false,
            details: { requiredEnergyKwh: 2, pvFirst: true },
        }), "balanced", []);
        flex.pvFirst = true;
        flex.gridEligible = false;
        const result = (0, allocation_1.runAllocation)({
            slots,
            candidates: [flex],
            globalMode: "balanced",
            modeAllowsOptimization: true,
            gridImportAllowedPolicy: true,
            mutualExclusions: [],
            nowMs: NOW.getTime(),
        });
        strict_1.default.ok(result.allocations.every((a) => a.gridPowerW === 0));
    });
    (0, node_test_1.it)("skips micro allocations below minPowerW (no 8 W Schein-Slots)", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([
            { startIso: slot1Start, endIso: slot1End },
            { startIso: "2026-07-11T10:15:00.000Z", endIso: "2026-07-11T10:30:00.000Z" },
        ], [
            forecastSlot(slot1Start, slot1End, { pv: 5000, load: 1000 }),
            forecastSlot("2026-07-11T10:15:00.000Z", "2026-07-11T10:30:00.000Z", { pv: 5000, load: 1000 }),
        ], 11000, 13800);
        // 0.1 kWh → ceil zu 400 W < 1700 W Mindeststufe → keine Allocation.
        const flex = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
            gridEligible: false,
            details: { requiredEnergyKwh: 0.1, maxPowerW: 1700, minPowerW: 1700, pvFirst: true },
        }), "balanced", []);
        strict_1.default.equal(flex.minPowerW, 1700);
        const result = (0, allocation_1.runAllocation)({
            slots,
            candidates: [flex],
            globalMode: "balanced",
            modeAllowsOptimization: true,
            gridImportAllowedPolicy: true,
            mutualExclusions: [],
            nowMs: NOW.getTime(),
        });
        strict_1.default.equal(result.allocations.length, 0);
        strict_1.default.ok(result.unallocated.some((u) => u.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE));
    });
    (0, node_test_1.it)("allocates only slots that can carry at least minPowerW", () => {
        const slots = (0, constraints_2.buildDailyPlanSlots)([
            { startIso: slot1Start, endIso: slot1End },
            { startIso: "2026-07-11T10:15:00.000Z", endIso: "2026-07-11T10:30:00.000Z" },
        ], [
            forecastSlot(slot1Start, slot1End, { pv: 1500, load: 1000 }), // surplus 500 < 1700
            forecastSlot("2026-07-11T10:15:00.000Z", "2026-07-11T10:30:00.000Z", { pv: 4000, load: 1000 }), // 3000
        ], 11000, 13800);
        const flex = (0, policy_1.buildAllocationCandidate)(flexContribution(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
            gridEligible: false,
            details: { requiredEnergyKwh: 0.5, maxPowerW: 1700, minPowerW: 1700, pvFirst: true },
        }), "balanced", []);
        const result = (0, allocation_1.runAllocation)({
            slots,
            candidates: [flex],
            globalMode: "balanced",
            modeAllowsOptimization: true,
            gridImportAllowedPolicy: true,
            mutualExclusions: [],
            nowMs: NOW.getTime(),
        });
        strict_1.default.ok(result.allocations.length >= 1);
        strict_1.default.ok(result.allocations.every((a) => (a.allocatedPowerW ?? 0) >= 1700));
        strict_1.default.ok(result.allocations.every((a) => a.slot.startIso !== slot1Start));
    });
});
(0, node_test_1.describe)("daily plan build", () => {
    (0, node_test_1.it)("builds full plan from forecast", () => {
        const slot1Start = "2026-07-11T10:00:00.000Z";
        const slot1End = "2026-07-11T10:15:00.000Z";
        const forecast = minimalForecast({
            slots: [forecastSlot(slot1Start, slot1End, { pv: 6000, load: 2000, price: 18 })],
            contributions: [
                flexContribution(contribution_ids_1.CONTRIBUTION_IDS.BATTERY_CHARGE, "battery", {
                    details: { requiredEnergyKwh: 1 },
                }),
            ],
        });
        const plan = (0, build_1.buildDailyPlanFromForecast)(NOW, TZ, "balanced", forecast, {
            policySnapshot: null,
            energyPriority: ["battery"],
            mutualExclusions: [],
            gridImportAllowedPolicy: true,
            effectiveMaxGridImportW: 11000,
            configuredHouseFuseLimitW: 13800,
            modePolicy: { mode: "balanced", allowOptimization: true },
        });
        strict_1.default.equal(plan.date, "2026-07-11");
        strict_1.default.equal(plan.slotMinutes, 15);
        strict_1.default.ok(plan.slots.length > 0);
        strict_1.default.equal(plan.status, "ready");
    });
    (0, node_test_1.it)("revision payload ignores generatedAt", () => {
        const forecast = minimalForecast();
        const plan1 = (0, build_1.buildDailyPlanFromForecast)(NOW, TZ, "balanced", forecast, {
            policySnapshot: null,
            energyPriority: [],
            mutualExclusions: [],
            gridImportAllowedPolicy: true,
            effectiveMaxGridImportW: 11000,
            configuredHouseFuseLimitW: 13800,
            modePolicy: { mode: "balanced", allowOptimization: true },
        });
        const plan2 = { ...plan1, generatedAt: new Date("2026-07-11T10:05:00.000Z").toISOString() };
        strict_1.default.equal((0, build_1.dailyPlanRevisionPayload)(plan1), (0, build_1.dailyPlanRevisionPayload)(plan2));
    });
    (0, node_test_1.it)("computes grid cost when price present", () => {
        const e = (0, slots_1.energyKwhFromPower)(2000, 15);
        strict_1.default.ok(e > 0);
        const cost = e * 20;
        strict_1.default.ok(cost > 0);
    });
    (0, node_test_1.it)("missing forecast inputs yields missing_inputs status", () => {
        const forecast = minimalForecast({ status: "missing_inputs" });
        const plan = (0, build_1.buildDailyPlanFromForecast)(NOW, TZ, "balanced", forecast, {
            policySnapshot: null,
            energyPriority: [],
            mutualExclusions: [],
            gridImportAllowedPolicy: true,
            effectiveMaxGridImportW: 11000,
            configuredHouseFuseLimitW: 13800,
            modePolicy: { mode: "balanced", allowOptimization: true },
        });
        strict_1.default.equal(plan.status, "missing_inputs");
    });
    (0, node_test_1.it)("flexibleRequestedEnergyKwh totals dedupe per contribution across allocation rows", () => {
        const s1 = "2026-07-11T10:00:00.000Z";
        const e1 = "2026-07-11T10:15:00.000Z";
        const s2 = "2026-07-11T10:15:00.000Z";
        const e2 = "2026-07-11T10:30:00.000Z";
        const s3 = "2026-07-11T10:30:00.000Z";
        const e3 = "2026-07-11T10:45:00.000Z";
        const forecast = minimalForecast({
            slots: [
                forecastSlot(s1, e1, { pv: 3000, load: 500 }),
                forecastSlot(s2, e2, { pv: 3000, load: 500 }),
                forecastSlot(s3, e3, { pv: 3000, load: 500 }),
            ],
            contributions: [
                flexContribution(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
                    details: { requiredEnergyKwh: 1 },
                }),
            ],
        });
        const plan = (0, build_1.buildDailyPlanFromForecast)(NOW, TZ, "balanced", forecast, {
            policySnapshot: null,
            energyPriority: ["immersion_heater"],
            mutualExclusions: [],
            gridImportAllowedPolicy: true,
            effectiveMaxGridImportW: 11000,
            configuredHouseFuseLimitW: 13800,
            modePolicy: { mode: "balanced", allowOptimization: true },
        });
        const ihRows = plan.allocations.filter((a) => a.contributionId === contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE);
        strict_1.default.ok(ihRows.length >= 2, "expected multi-slot IH allocation for regression");
        strict_1.default.equal(plan.totals.flexibleRequestedEnergyKwh, 1);
    });
});
(0, node_test_1.describe)("grid import effective", () => {
    (0, node_test_1.it)("blocks when policy disallows", () => {
        strict_1.default.equal((0, policy_1.gridImportEffective)(true, false, true, "balanced"), false);
    });
    (0, node_test_1.it)("blocks when global mode off", () => {
        strict_1.default.equal((0, policy_1.gridImportEffective)(true, true, true, "off"), false);
    });
});
