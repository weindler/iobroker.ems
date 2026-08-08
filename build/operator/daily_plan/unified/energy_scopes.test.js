"use strict";
/**
 * Beta-Befund 001 — Day / Goal / Horizon Scope-Semantik.
 */
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const allocate_1 = require("./allocate");
const fixtures_1 = require("./fixtures");
const energy_scopes_1 = require("./energy_scopes");
const product_summary_1 = require("../../../beta/product_summary");
const explain_1 = require("../../../learning/day_evaluation/explain");
const build_1 = require("../../../learning/day_evaluation/build");
const time_1 = require("../../time");
const TZ = "Europe/Berlin";
function multiDayHorizonInput(opts) {
    const days = opts?.days ?? 7;
    const todayKwh = opts?.todayKwh ?? 40;
    const otherDayKwh = opts?.otherDayKwh ?? 260 / Math.max(1, days - 1);
    const nowIso = opts?.nowIso ?? "2026-08-04T06:00:00.000Z";
    const todayKey = (0, time_1.localDateKeyInTimezone)(new Date(Date.parse(nowIso)), TZ);
    const allSlots = [];
    const pvSlots = [];
    const loadSlots = [];
    const priceSlots = [];
    for (let d = 0; d < days; d++) {
        const dateKey = (0, time_1.addDaysToDateKey)(todayKey, d);
        const dayStart = (0, time_1.isoAtTimezoneLocal)(dateKey, 0, 0, TZ);
        const daySlots = (0, fixtures_1.buildSlots)(dayStart, 24);
        const dayKwh = d === 0 ? todayKwh : otherDayKwh;
        const perSlot = dayKwh / daySlots.length;
        for (const s of daySlots) {
            allSlots.push(s);
            pvSlots.push({
                slot: s,
                forecastPowerW: (perSlot / 0.25) * 1000,
                observedPowerW: null,
                energyKwh: perSlot,
            });
            loadSlots.push({
                slot: s,
                forecastPowerW: 400,
                observedPowerW: null,
                energyKwh: 0.1,
            });
            priceSlots.push({
                slot: s,
                importCtPerKwh: 22,
                exportCtPerKwh: 8,
                gridImportAllowed: true,
            });
        }
    }
    const base = (0, fixtures_1.golden001Input)();
    base.time = {
        ...base.time,
        nowIso,
        timezone: TZ,
        slots: allSlots,
        horizonStartIso: allSlots[0].startIso,
        horizonEndIso: allSlots[allSlots.length - 1].endIso,
    };
    base.pv = {
        ...base.pv,
        slots: pvSlots,
        expectedDayEnergyKwh: todayKwh,
        previousExpectedDayEnergyKwh: null,
        biasCorrected: true,
    };
    base.houseLoad = {
        ...base.houseLoad,
        slots: loadSlots,
        expectedDayEnergyKwh: 9.6,
    };
    base.prices = { ...base.prices, slots: priceSlots };
    base.wallbox =
        opts?.deadlineIso === null
            ? null
            : {
                connectedNow: true,
                presenceWindows: [
                    {
                        available: true,
                        startIso: allSlots[0].startIso,
                        endIso: allSlots[allSlots.length - 1].endIso,
                    },
                ],
                presenceHardConstraint: true,
                vehicleProfileId: "test_vehicle",
                vehicleSocPct: 40,
                socSource: "direct",
                fallbackEnergyNeedKwh: null,
                vehicleCapacityKwh: 70,
                targetSocPct: 80,
                requiredEnergyKwh: 20,
                deadlineIso: opts?.deadlineIso ?? (0, time_1.isoAtTimezoneLocal)((0, time_1.addDaysToDateKey)(todayKey, 1), 5, 30, TZ),
                energyGoalHard: true,
                minChargePowerW: 1400,
                maxChargePowerW: 11000,
                chargeLossFactor: 1.1,
                evccExecutionMaster: true,
                uncertainty: base.pv.uncertainty,
                freshness: base.pv.freshness,
            };
    return base;
}
(0, node_test_1.describe)("BETA-001 energy scopes: multi-day horizon", () => {
    (0, node_test_1.it)("keeps ~7d slots but separates today vs horizon PV", () => {
        const nowIso = (0, time_1.isoAtTimezoneLocal)("2026-08-04", 0, 5, TZ);
        const input = multiDayHorizonInput({
            nowIso,
            days: 7,
            todayKwh: 40,
            otherDayKwh: 260 / 6,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok(input.time.slots.length >= 7 * 96 - 1, "multi-day slots retained in input");
        strict_1.default.ok(Date.parse(plan.horizonEndIso) - Date.parse(plan.horizonStartIso) >= 6 * 24 * 3600_000, "unified horizon remains multi-day (not capped to 24/48h)");
        strict_1.default.ok(Math.abs((plan.expectedPvEnergyTodayKwh ?? 0) - 40) < 0.05);
        strict_1.default.ok(Math.abs((plan.expectedPvEnergyHorizonKwh ?? 0) - 300) < 2);
        strict_1.default.ok((plan.expectedPvEnergyHorizonKwh ?? 0) > (plan.expectedPvEnergyTodayKwh ?? 0) * 2);
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan, { batteryStartSocPct: input.battery.socPct });
        strict_1.default.match(summary, /Heute 40[,.]0 kWh PV erwartet/);
        strict_1.default.ok(!/Heute 30\d/.test(summary), "summary must not show ~300 kWh as today");
        const explain = (0, explain_1.buildDeterministicDayExplanation)(plan);
        strict_1.default.equal(explain.heute.pvExpectedKwh, plan.expectedPvEnergyTodayKwh);
        strict_1.default.equal(explain.horizon.pvExpectedKwh, plan.expectedPvEnergyHorizonKwh);
    });
});
(0, node_test_1.describe)("BETA-001 energy scopes: late-day planning", () => {
    (0, node_test_1.it)("day scope ends at local midnight, not now+24h", () => {
        // 18:00 Europe/Berlin = 16:00Z in August (CEST)
        const nowIso = "2026-08-04T16:00:00.000Z";
        const todayKey = (0, time_1.localDateKeyInTimezone)(new Date(Date.parse(nowIso)), TZ);
        const { endMs } = (0, energy_scopes_1.localDayBoundsMs)(todayKey, TZ);
        const input = multiDayHorizonInput({ nowIso, days: 3, todayKwh: 43.6, otherDayKwh: 40 });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.expectedPvEnergyTodayKwh, 43.6);
        strict_1.default.ok((plan.expectedPvEnergyHorizonKwh ?? 0) > 43.6);
        // Remaining horizon extends past local midnight — Day Scope stays calendar-day total.
        strict_1.default.ok(Date.parse(plan.horizonEndIso) > endMs);
        // Rolling now→now+24h would include tomorrow morning; Day Scope must not equal that sum.
        const rolling24hEnd = Date.parse(nowIso) + 24 * 3600_000;
        const rollingPv = input.pv.slots
            .filter((s) => {
            const t = Date.parse(s.slot.startIso);
            return t >= Date.parse(nowIso) && t < rolling24hEnd;
        })
            .reduce((a, s) => a + (s.energyKwh ?? 0), 0);
        strict_1.default.ok(Math.abs(rollingPv - 43.6) > 1, "rolling 24h must differ from calendar-day today");
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan);
        strict_1.default.match(summary, /Heute 43[,.]6 kWh PV erwartet/);
    });
});
(0, node_test_1.describe)("BETA-001 energy scopes: deadline tomorrow", () => {
    (0, node_test_1.it)("goal scope may cross midnight; summary does not use goal PV as today", () => {
        const nowIso = "2026-08-04T18:00:00.000Z";
        const todayKey = (0, time_1.localDateKeyInTimezone)(new Date(Date.parse(nowIso)), TZ);
        const deadlineIso = (0, time_1.isoAtTimezoneLocal)((0, time_1.addDaysToDateKey)(todayKey, 1), 5, 30, TZ);
        const input = multiDayHorizonInput({
            nowIso,
            days: 3,
            todayKwh: 40,
            otherDayKwh: 45,
            deadlineIso,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.equal(plan.expectedPvEnergyTodayKwh, 40);
        strict_1.default.ok(plan.expectedPvEnergyToGoalKwh !== null);
        // Goal bis morgen früh enthält heutigen Tag + Morgenstunden → > Day Scope.
        strict_1.default.ok((plan.expectedPvEnergyToGoalKwh ?? 0) > (plan.expectedPvEnergyTodayKwh ?? 0));
        strict_1.default.ok((plan.expectedPvEnergyHorizonKwh ?? 0) >= (plan.expectedPvEnergyToGoalKwh ?? 0) - 0.01);
        strict_1.default.ok(Date.parse(deadlineIso) > Date.parse((0, time_1.isoAtTimezoneLocal)(todayKey, 23, 59, TZ)));
        const toGoal = (0, energy_scopes_1.sumEnergyToDeadline)(input.pv.slots, deadlineIso);
        strict_1.default.ok(Math.abs((plan.expectedPvEnergyToGoalKwh ?? 0) - (toGoal ?? 0)) < 0.05);
        const explain = (0, explain_1.buildDeterministicDayExplanation)(plan);
        strict_1.default.equal(explain.heute.pvExpectedKwh, 40);
        strict_1.default.equal(explain.fahrzeug.pvToGoalKwh, plan.expectedPvEnergyToGoalKwh);
        strict_1.default.equal(explain.fahrzeug.deadlineIso, deadlineIso);
        const summary = (0, product_summary_1.buildProductSummaryDe)(plan);
        strict_1.default.match(summary, /Heute 40[,.]0 kWh PV erwartet/);
        strict_1.default.ok(!/Heute \d+[,.]\d kWh PV erwartet/.test(summary.replace("Heute 40,0 kWh PV erwartet", "")), "no second Heute-PV line with goal/horizon energy");
    });
});
(0, node_test_1.describe)("BETA-001 energy scopes: horizon not capped to 48h", () => {
    (0, node_test_1.it)("rejects accidental 24h/48h horizon shrink as the 'fix'", () => {
        const input = multiDayHorizonInput({
            nowIso: (0, time_1.isoAtTimezoneLocal)("2026-08-04", 0, 5, TZ),
            days: 7,
            todayKwh: 40,
            otherDayKwh: 42,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        const horizonHours = (Date.parse(plan.horizonEndIso) - Date.parse(plan.horizonStartIso)) / 3_600_000;
        strict_1.default.ok(horizonHours > 48, `horizonHours=${horizonHours} must stay > 48h`);
        strict_1.default.ok(horizonHours >= 6 * 24 - 1, "approx. 7-day horizon retained");
        strict_1.default.ok(input.time.slots.length > 48 * 4);
    });
});
(0, node_test_1.describe)("BETA-001 energy scopes: local day boundary / TZ", () => {
    (0, node_test_1.it)("splits energy at Europe/Berlin midnight, not UTC midnight", () => {
        // Slot 2026-08-03T22:00Z–22:15Z = 00:00–00:15 Berlin (CEST) on 2026-08-04
        const startIso = "2026-08-03T22:00:00.000Z";
        const endIso = "2026-08-03T22:15:00.000Z";
        const dayKey = "2026-08-04";
        const { startMs, endMs } = (0, energy_scopes_1.localDayBoundsMs)(dayKey, TZ);
        strict_1.default.equal(new Date(startMs).toISOString(), "2026-08-03T22:00:00.000Z");
        strict_1.default.equal(new Date(endMs).toISOString(), "2026-08-04T22:00:00.000Z");
        const full = (0, energy_scopes_1.energyOverlapKwh)(startIso, endIso, 1, startMs, endMs);
        strict_1.default.ok(Math.abs(full - 1) < 1e-9);
        // UTC-day key would wrongly exclude this slot from 2026-08-04 if using ISO date only
        strict_1.default.equal(startIso.slice(0, 10), "2026-08-03");
        const slots = [{ slot: { startIso, endIso }, energyKwh: 1 }];
        strict_1.default.equal((0, energy_scopes_1.sumEnergyForLocalDay)(slots, "2026-08-04", TZ), 1);
        strict_1.default.equal((0, energy_scopes_1.sumEnergyForLocalDay)(slots, "2026-08-03", TZ), 0);
    });
    (0, node_test_1.it)("apportions a slot that straddles the local day boundary", () => {
        // Artificial 30-min slot across Berlin midnight (normally 15-min aligned).
        const startIso = "2026-08-03T21:50:00.000Z"; // 23:50 Berlin
        const endIso = "2026-08-03T22:20:00.000Z"; // 00:20 Berlin
        const slots = [{ slot: { startIso, endIso }, energyKwh: 3 }];
        const on4 = (0, energy_scopes_1.sumEnergyForLocalDay)(slots, "2026-08-04", TZ);
        const on3 = (0, energy_scopes_1.sumEnergyForLocalDay)(slots, "2026-08-03", TZ);
        strict_1.default.ok(Math.abs(on3 + on4 - 3) < 1e-6);
        strict_1.default.ok(on4 > 0 && on3 > 0);
        strict_1.default.ok(Math.abs(on4 - 2) < 0.05); // 20 of 30 minutes on Aug 4
    });
});
(0, node_test_1.describe)("BETA-001 energy scopes: day evaluation / learning", () => {
    (0, node_test_1.it)("session finalExpectedPv uses today, not horizon sum", () => {
        const input = multiDayHorizonInput({
            nowIso: (0, time_1.isoAtTimezoneLocal)("2026-08-04", 0, 5, TZ),
            days: 7,
            todayKwh: 43.6,
            otherDayKwh: 40,
        });
        const plan = (0, allocate_1.allocateUnifiedDayPlan)(input);
        strict_1.default.ok((plan.expectedPvEnergyHorizonKwh ?? 0) > 200);
        const snap = (0, build_1.snapshotFromUnifiedSession)({
            date: "2026-08-04",
            timezone: TZ,
            initialPlanId: plan.planId,
            finalPlan: plan,
            initialGeneration: 1,
            replanCount: 0,
            replanReasons: [],
            initialExpectedPvKwh: input.pv.expectedDayEnergyKwh,
            batteryStartSocPct: 40,
            plannedImmersionTargetTempC: 56,
        });
        strict_1.default.equal(snap.initialExpectedPvKwh, 43.6);
        strict_1.default.equal(snap.finalExpectedPvKwh, plan.expectedPvEnergyTodayKwh);
        strict_1.default.equal(snap.finalExpectedPvKwh, 43.6);
        strict_1.default.notEqual(snap.finalExpectedPvKwh, plan.expectedPvEnergyHorizonKwh);
    });
});
