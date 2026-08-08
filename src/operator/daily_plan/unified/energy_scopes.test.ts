/**
 * Beta-Befund 001 — Day / Goal / Horizon Scope-Semantik.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildSlots, golden001Input } from "./fixtures";
import {
	energyOverlapKwh,
	localDayBoundsMs,
	sumEnergyForLocalDay,
	sumEnergyToDeadline,
} from "./energy_scopes";
import { buildProductSummaryDe } from "../../../beta/product_summary";
import { buildDeterministicDayExplanation } from "../../../learning/day_evaluation/explain";
import { snapshotFromUnifiedSession } from "../../../learning/day_evaluation/build";
import { addDaysToDateKey, isoAtTimezoneLocal, localDateKeyInTimezone } from "../../time";
import type { UnifiedDayPlannerInput } from "./types";

const TZ = "Europe/Berlin";

function multiDayHorizonInput(opts?: {
	nowIso?: string;
	days?: number;
	todayKwh?: number;
	otherDayKwh?: number;
	deadlineIso?: string | null;
}): UnifiedDayPlannerInput {
	const days = opts?.days ?? 7;
	const todayKwh = opts?.todayKwh ?? 40;
	const otherDayKwh = opts?.otherDayKwh ?? 260 / Math.max(1, days - 1);
	const nowIso = opts?.nowIso ?? "2026-08-04T06:00:00.000Z";
	const todayKey = localDateKeyInTimezone(new Date(Date.parse(nowIso)), TZ);

	const allSlots: ReturnType<typeof buildSlots> = [];
	const pvSlots: UnifiedDayPlannerInput["pv"]["slots"] = [];
	const loadSlots: UnifiedDayPlannerInput["houseLoad"]["slots"] = [];
	const priceSlots: UnifiedDayPlannerInput["prices"]["slots"] = [];

	for (let d = 0; d < days; d++) {
		const dateKey = addDaysToDateKey(todayKey, d);
		const dayStart = isoAtTimezoneLocal(dateKey, 0, 0, TZ);
		const daySlots = buildSlots(dayStart, 24);
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

	const base = golden001Input();
	base.time = {
		...base.time,
		nowIso,
		timezone: TZ,
		slots: allSlots,
		horizonStartIso: allSlots[0]!.startIso,
		horizonEndIso: allSlots[allSlots.length - 1]!.endIso,
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
							startIso: allSlots[0]!.startIso,
							endIso: allSlots[allSlots.length - 1]!.endIso,
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
					deadlineIso: opts?.deadlineIso ?? isoAtTimezoneLocal(addDaysToDateKey(todayKey, 1), 5, 30, TZ),
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

describe("BETA-001 energy scopes: multi-day horizon", () => {
	it("keeps ~7d slots but separates today vs horizon PV", () => {
		const nowIso = isoAtTimezoneLocal("2026-08-04", 0, 5, TZ);
		const input = multiDayHorizonInput({
			nowIso,
			days: 7,
			todayKwh: 40,
			otherDayKwh: 260 / 6,
		});
		const plan = allocateUnifiedDayPlan(input);

		assert.ok(input.time.slots.length >= 7 * 96 - 1, "multi-day slots retained in input");
		assert.ok(
			Date.parse(plan.horizonEndIso) - Date.parse(plan.horizonStartIso) >= 6 * 24 * 3600_000,
			"unified horizon remains multi-day (not capped to 24/48h)",
		);

		assert.ok(Math.abs((plan.expectedPvEnergyTodayKwh ?? 0) - 40) < 0.05);
		assert.ok(Math.abs((plan.expectedPvEnergyHorizonKwh ?? 0) - 300) < 2);
		assert.ok((plan.expectedPvEnergyHorizonKwh ?? 0) > (plan.expectedPvEnergyTodayKwh ?? 0) * 2);

		const summary = buildProductSummaryDe(plan, { batteryStartSocPct: input.battery.socPct });
		assert.match(summary, /Heute 40[,.]0 kWh PV erwartet/);
		assert.ok(!/Heute 30\d/.test(summary), "summary must not show ~300 kWh as today");

		const explain = buildDeterministicDayExplanation(plan);
		assert.equal(explain.heute.pvExpectedKwh, plan.expectedPvEnergyTodayKwh);
		assert.equal(explain.horizon.pvExpectedKwh, plan.expectedPvEnergyHorizonKwh);
	});
});

describe("BETA-001 energy scopes: late-day planning", () => {
	it("day scope ends at local midnight, not now+24h", () => {
		// 18:00 Europe/Berlin = 16:00Z in August (CEST)
		const nowIso = "2026-08-04T16:00:00.000Z";
		const todayKey = localDateKeyInTimezone(new Date(Date.parse(nowIso)), TZ);
		const { endMs } = localDayBoundsMs(todayKey, TZ);
		const input = multiDayHorizonInput({ nowIso, days: 3, todayKwh: 43.6, otherDayKwh: 40 });
		const plan = allocateUnifiedDayPlan(input);

		assert.equal(plan.expectedPvEnergyTodayKwh, 43.6);
		assert.ok((plan.expectedPvEnergyHorizonKwh ?? 0) > 43.6);

		// Remaining horizon extends past local midnight — Day Scope stays calendar-day total.
		assert.ok(Date.parse(plan.horizonEndIso) > endMs);

		// Rolling now→now+24h would include tomorrow morning; Day Scope must not equal that sum.
		const rolling24hEnd = Date.parse(nowIso) + 24 * 3600_000;
		const rollingPv = input.pv.slots
			.filter((s) => {
				const t = Date.parse(s.slot.startIso);
				return t >= Date.parse(nowIso) && t < rolling24hEnd;
			})
			.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
		assert.ok(Math.abs(rollingPv - 43.6) > 1, "rolling 24h must differ from calendar-day today");

		const summary = buildProductSummaryDe(plan);
		assert.match(summary, /Heute 43[,.]6 kWh PV erwartet/);
	});
});

describe("BETA-001 energy scopes: deadline tomorrow", () => {
	it("goal scope may cross midnight; summary does not use goal PV as today", () => {
		const nowIso = "2026-08-04T18:00:00.000Z";
		const todayKey = localDateKeyInTimezone(new Date(Date.parse(nowIso)), TZ);
		const deadlineIso = isoAtTimezoneLocal(addDaysToDateKey(todayKey, 1), 5, 30, TZ);
		const input = multiDayHorizonInput({
			nowIso,
			days: 3,
			todayKwh: 40,
			otherDayKwh: 45,
			deadlineIso,
		});
		const plan = allocateUnifiedDayPlan(input);

		assert.equal(plan.expectedPvEnergyTodayKwh, 40);
		assert.ok(plan.expectedPvEnergyToGoalKwh !== null);
		// Goal bis morgen früh enthält heutigen Tag + Morgenstunden → > Day Scope.
		assert.ok((plan.expectedPvEnergyToGoalKwh ?? 0) > (plan.expectedPvEnergyTodayKwh ?? 0));
		assert.ok((plan.expectedPvEnergyHorizonKwh ?? 0) >= (plan.expectedPvEnergyToGoalKwh ?? 0) - 0.01);
		assert.ok(Date.parse(deadlineIso) > Date.parse(isoAtTimezoneLocal(todayKey, 23, 59, TZ)));

		const toGoal = sumEnergyToDeadline(input.pv.slots, deadlineIso);
		assert.ok(Math.abs((plan.expectedPvEnergyToGoalKwh ?? 0) - (toGoal ?? 0)) < 0.05);

		const explain = buildDeterministicDayExplanation(plan);
		assert.equal(explain.heute.pvExpectedKwh, 40);
		assert.equal(explain.fahrzeug.pvToGoalKwh, plan.expectedPvEnergyToGoalKwh);
		assert.equal(explain.fahrzeug.deadlineIso, deadlineIso);

		const summary = buildProductSummaryDe(plan);
		assert.match(summary, /Heute 40[,.]0 kWh PV erwartet/);
		assert.ok(
			!/Heute \d+[,.]\d kWh PV erwartet/.test(summary.replace("Heute 40,0 kWh PV erwartet", "")),
			"no second Heute-PV line with goal/horizon energy",
		);
	});
});

describe("BETA-001 energy scopes: horizon not capped to 48h", () => {
	it("rejects accidental 24h/48h horizon shrink as the 'fix'", () => {
		const input = multiDayHorizonInput({
			nowIso: isoAtTimezoneLocal("2026-08-04", 0, 5, TZ),
			days: 7,
			todayKwh: 40,
			otherDayKwh: 42,
		});
		const plan = allocateUnifiedDayPlan(input);
		const horizonHours =
			(Date.parse(plan.horizonEndIso) - Date.parse(plan.horizonStartIso)) / 3_600_000;
		assert.ok(horizonHours > 48, `horizonHours=${horizonHours} must stay > 48h`);
		assert.ok(horizonHours >= 6 * 24 - 1, "approx. 7-day horizon retained");
		assert.ok(input.time.slots.length > 48 * 4);
	});
});

describe("BETA-001 energy scopes: local day boundary / TZ", () => {
	it("splits energy at Europe/Berlin midnight, not UTC midnight", () => {
		// Slot 2026-08-03T22:00Z–22:15Z = 00:00–00:15 Berlin (CEST) on 2026-08-04
		const startIso = "2026-08-03T22:00:00.000Z";
		const endIso = "2026-08-03T22:15:00.000Z";
		const dayKey = "2026-08-04";
		const { startMs, endMs } = localDayBoundsMs(dayKey, TZ);
		assert.equal(new Date(startMs).toISOString(), "2026-08-03T22:00:00.000Z");
		assert.equal(new Date(endMs).toISOString(), "2026-08-04T22:00:00.000Z");

		const full = energyOverlapKwh(startIso, endIso, 1, startMs, endMs);
		assert.ok(Math.abs(full - 1) < 1e-9);

		// UTC-day key would wrongly exclude this slot from 2026-08-04 if using ISO date only
		assert.equal(startIso.slice(0, 10), "2026-08-03");
		const slots = [{ slot: { startIso, endIso }, energyKwh: 1 }];
		assert.equal(sumEnergyForLocalDay(slots, "2026-08-04", TZ), 1);
		assert.equal(sumEnergyForLocalDay(slots, "2026-08-03", TZ), 0);
	});

	it("apportions a slot that straddles the local day boundary", () => {
		// Artificial 30-min slot across Berlin midnight (normally 15-min aligned).
		const startIso = "2026-08-03T21:50:00.000Z"; // 23:50 Berlin
		const endIso = "2026-08-03T22:20:00.000Z"; // 00:20 Berlin
		const slots = [{ slot: { startIso, endIso }, energyKwh: 3 }];
		const on4 = sumEnergyForLocalDay(slots, "2026-08-04", TZ);
		const on3 = sumEnergyForLocalDay(slots, "2026-08-03", TZ);
		assert.ok(Math.abs(on3 + on4 - 3) < 1e-6);
		assert.ok(on4 > 0 && on3 > 0);
		assert.ok(Math.abs(on4 - 2) < 0.05); // 20 of 30 minutes on Aug 4
	});
});

describe("BETA-001 energy scopes: day evaluation / learning", () => {
	it("session finalExpectedPv uses today, not horizon sum", () => {
		const input = multiDayHorizonInput({
			nowIso: isoAtTimezoneLocal("2026-08-04", 0, 5, TZ),
			days: 7,
			todayKwh: 43.6,
			otherDayKwh: 40,
		});
		const plan = allocateUnifiedDayPlan(input);
		assert.ok((plan.expectedPvEnergyHorizonKwh ?? 0) > 200);

		const snap = snapshotFromUnifiedSession({
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
		assert.equal(snap.initialExpectedPvKwh, 43.6);
		assert.equal(snap.finalExpectedPvKwh, plan.expectedPvEnergyTodayKwh);
		assert.equal(snap.finalExpectedPvKwh, 43.6);
		assert.notEqual(snap.finalExpectedPvKwh, plan.expectedPvEnergyHorizonKwh);
	});
});
