"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * v0.2.23 — akzeptiertes Compare-`defer_tomorrow` sperrt nur Soft-IH über slotAllowed.
 */
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const contribution_ids_1 = require("../../contribution_ids");
const quality_1 = require("../../quality");
const time_1 = require("../../time");
const types_1 = require("../../contributions/types");
const contributor_1 = require("../../contributor");
const allocate_1 = require("./allocate");
const from_forecast_context_1 = require("./from_forecast_context");
const score_allocate_1 = require("./score_allocate");
const strategy_preferences_1 = require("../../../ai/strategy_preferences");
const Q = (0, quality_1.operatorQuality)("valid", "test", 80);
const TZ = "Europe/Berlin";
const NOW = new Date("2026-06-15T08:00:00.000Z");
const EMPTY_AT_60H = "2026-06-17T20:00:00.000Z";
const HORIZON_HOURS = 40;
function contrib(id, opts) {
    const { details = {}, ...rest } = opts;
    const contributor = id.startsWith("immersion")
        ? (0, contributor_1.addonContributorRef)("immersion_heater")
        : id === contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY
            ? (0, types_1.pvContributorRef)()
            : id === contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED
                ? (0, contributor_1.systemContributorRef)("house_load")
                : (0, contributor_1.systemContributorRef)("grid_supply");
    return (0, types_1.baseContribution)(id, contributor, "consume", ["demand_flex"], {
        generatedAt: NOW.toISOString(),
        validUntil: null,
        revision: 1,
        enabled: true,
        flexible: true,
        gridEligible: false,
        quality: Q,
        reasonDe: "test",
        details,
        slots: [],
        ...rest,
    });
}
function ihDetails(over = {}) {
    return {
        bufferTempC: 54,
        boilerTempC: 58,
        boilerMinTempC: 50,
        targetTempC: 61.8,
        planningMinTempC: 44,
        mandatoryMinTempC: 50,
        planningMaxTempC: 63,
        requiredEnergyKwh: 1.7,
        maxPowerW: 1700,
        minPowerW: 1700,
        pvPrechargeActive: true,
        coolingRateCPerHAvg: null,
        estimatedEmptyAt: EMPTY_AT_60H,
        boilerEstimatedEmptyAt: EMPTY_AT_60H,
        emptyAtPlanningUsable: true,
        boilerEmptyAtUsable: true,
        boilerSensorDegraded: false,
        thermalLearningStatus: "ok",
        nightBridgeActive: false,
        hygieneDue: false,
        hygieneMandatoryKwh: null,
        ...over,
    };
}
function buildContext(over = {}) {
    const { ihDetails: ihOver, ...ctxOver } = over;
    const start = NOW.getTime();
    const slots = [];
    for (let i = 0; i < HORIZON_HOURS * 4; i++) {
        const a = new Date(start + i * 15 * 60_000).toISOString();
        const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
        const h = new Date(a).getUTCHours();
        const pv = h >= 6 && h < 18 ? 4000 : 40;
        const house = 300;
        slots.push({
            slot: { startIso: a, endIso: b },
            pvPowerW: pv,
            houseLoadPowerW: house,
            fixedBalancePowerW: pv - house,
            gridPriceCtPerKwh: 25,
            gridImportAllowed: true,
            gridMaxImportPowerW: 30000,
            outdoorTempC: null,
            quality: Q,
            reasonDe: "",
        });
    }
    return {
        now: NOW,
        timezone: TZ,
        globalMode: "balanced",
        forecastPlan: {
            generatedAt: NOW.toISOString(),
            validUntil: new Date(start + HORIZON_HOURS * 3600_000).toISOString(),
            revision: 1,
            timezone: TZ,
            horizonStart: slots[0].slot.startIso,
            horizonEnd: slots[slots.length - 1].slot.endIso,
            slotMinutes: 15,
            status: "ready",
            reasonDe: "test",
            quality: Q,
            days: [
                {
                    date: "2026-06-15",
                    pvEnergyKwh: 40,
                    houseLoadEnergyKwh: 12,
                    renewableBalanceKwh: 28,
                    weatherMinTempC: null,
                    weatherMaxTempC: null,
                    quality: Q,
                    reasonDe: "test",
                },
            ],
            slots,
            contributions: [
                contrib(contribution_ids_1.CONTRIBUTION_IDS.PV_SUPPLY, { details: { correctedTodayKwh: 40, rawTodayKwh: 40 } }),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, { details: {} }),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.GRID_SUPPLY, { details: {} }),
                contrib(contribution_ids_1.CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
                    deadlineIso: EMPTY_AT_60H,
                    details: ihDetails(ihOver),
                }),
            ],
            activeContributors: [],
            excludedContributors: [],
        },
        observedPvPowerW: 4200,
        observedHouseLoadPowerW: 400,
        observedPvAgeSec: 5,
        observedHouseAgeSec: 5,
        feedInCtPerKwh: 9.3,
        preferImmersionLiveSurplusNow: true,
        passiveBatteryEnergyAvailable: false,
        ...ctxOver,
    };
}
function energyByConsumer(plan, consumerId) {
    return plan.allocations
        .filter((a) => a.consumerId === consumerId)
        .reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}
function energyOnLocalDay(plan, consumerId, dateKey) {
    let sum = 0;
    for (const a of plan.allocations) {
        if (a.consumerId !== consumerId)
            continue;
        if ((0, time_1.localDateKeyInTimezone)(new Date(a.slot.startIso), TZ) === dateKey) {
            sum += a.allocatedEnergyKwh;
        }
    }
    return sum;
}
function todaySlotIsos(ctx) {
    const todayKey = (0, time_1.localDateKeyInTimezone)(ctx.now, TZ);
    return ctx.forecastPlan.slots
        .filter((s) => (0, time_1.localDateKeyInTimezone)(new Date(s.slot.startIso), TZ) === todayKey)
        .map((s) => s.slot.startIso);
}
function tomorrowSlotIsos(ctx) {
    const todayKey = (0, time_1.localDateKeyInTimezone)(ctx.now, TZ);
    return ctx.forecastPlan.slots
        .filter((s) => (0, time_1.localDateKeyInTimezone)(new Date(s.slot.startIso), TZ) > todayKey)
        .map((s) => s.slot.startIso);
}
function retainedDeferPrefs(ctx) {
    return [
        ...todaySlotIsos(ctx).map((slotStartIso) => ({
            addonId: "immersion_heater",
            slotStartIso,
            weight: 0,
        })),
        ...tomorrowSlotIsos(ctx)
            .slice(0, 8)
            .map((slotStartIso) => ({
            addonId: "immersion_heater",
            slotStartIso,
            weight: 3,
        })),
    ];
}
(0, node_test_1.describe)("v0.2.23 accepted defer_tomorrow → Unified Soft slotAllowed", () => {
    (0, node_test_1.it)("akzeptiertes defer sperrt heutige Soft-IH-Slots, Live-Surplus umgeht das nicht", () => {
        const ctx = buildContext();
        const baseline = (0, allocate_1.allocateUnifiedDayPlan)((0, from_forecast_context_1.buildUnifiedInputFromForecastContext)(ctx), { generation: 1 });
        strict_1.default.ok(energyOnLocalDay(baseline, score_allocate_1.IMMERSION_SOFT_CONSUMER_ID, "2026-06-15") > 0.2, "ohne Pref muss Soft heute planbar sein");
        const disallowed = (0, strategy_preferences_1.acceptedImmersionSoftDisallowedSlotIsos)({
            activePlan: "b",
            prefs: retainedDeferPrefs(ctx),
        });
        strict_1.default.ok(disallowed.length > 0);
        const locked = (0, allocate_1.allocateUnifiedDayPlan)((0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({ ...ctx, immersionSoftDisallowedSlotIsos: disallowed }), { generation: 1 });
        strict_1.default.equal(energyOnLocalDay(locked, score_allocate_1.IMMERSION_SOFT_CONSUMER_ID, "2026-06-15"), 0, "heute keine Soft-IH-Allokation");
        strict_1.default.ok(energyOnLocalDay(locked, score_allocate_1.IMMERSION_SOFT_CONSUMER_ID, "2026-06-16") > 0.2, "morgen Soft-IH wieder planbar");
        strict_1.default.equal(energyByConsumer(locked, score_allocate_1.IMMERSION_HARD_CONSUMER_ID), 0);
    });
    (0, node_test_1.it)("nicht akzeptierte oder gelöschte Preference hat keine Wirkung", () => {
        const ctx = buildContext();
        const prefs = retainedDeferPrefs(ctx);
        const rejected = (0, strategy_preferences_1.acceptedImmersionSoftDisallowedSlotIsos)({ activePlan: "a", prefs });
        strict_1.default.deepEqual(rejected, []);
        const cleared = (0, strategy_preferences_1.parseAiSlotPreferencesJson)("[]");
        strict_1.default.deepEqual((0, strategy_preferences_1.acceptedImmersionSoftDisallowedSlotIsos)({ activePlan: "b", prefs: cleared }), []);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({ ...ctx, immersionSoftDisallowedSlotIsos: rejected }), { generation: 1 });
        strict_1.default.ok(energyOnLocalDay(plan, score_allocate_1.IMMERSION_SOFT_CONSUMER_ID, "2026-06-15") > 0.2);
    });
    (0, node_test_1.it)("stale/Folgetag-ISOs sperren heutige Soft-Slots nicht", () => {
        const ctx = buildContext();
        const stale = (0, strategy_preferences_1.acceptedImmersionSoftDisallowedSlotIsos)({
            activePlan: "b",
            prefs: [
                { addonId: "immersion_heater", slotStartIso: "2026-06-14T08:00:00.000Z", weight: 0 },
                { addonId: "immersion_heater", slotStartIso: "2026-06-14T12:00:00.000Z", weight: 0 },
            ],
        });
        strict_1.default.equal(stale.length, 2);
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({ ...ctx, immersionSoftDisallowedSlotIsos: stale }), { generation: 1 });
        strict_1.default.ok(energyOnLocalDay(plan, score_allocate_1.IMMERSION_SOFT_CONSUMER_ID, "2026-06-15") > 0.2);
    });
    (0, node_test_1.it)("Hard/Mandatory bleibt trotz Soft-defer heute planbar", () => {
        const ctx = buildContext({
            ihDetails: {
                boilerTempC: 50,
                boilerMinTempC: 50,
                requiredEnergyKwh: 1.7,
            },
        });
        const disallowed = (0, strategy_preferences_1.acceptedImmersionSoftDisallowedSlotIsos)({
            activePlan: "b",
            prefs: retainedDeferPrefs(ctx),
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)((0, from_forecast_context_1.buildUnifiedInputFromForecastContext)({ ...ctx, immersionSoftDisallowedSlotIsos: disallowed }), { generation: 1 });
        strict_1.default.ok(energyOnLocalDay(plan, score_allocate_1.IMMERSION_HARD_CONSUMER_ID, "2026-06-15") >= 0.4, "Boiler-Min/Hard darf heute laufen");
        strict_1.default.equal(energyOnLocalDay(plan, score_allocate_1.IMMERSION_SOFT_CONSUMER_ID, "2026-06-15"), 0);
    });
});
