import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acUnitContributionId } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import type { DailyAllocationEntry } from "../../../operator/daily_plan/types";
import { slotStartIsoFloored } from "../../../operator/daily_plan/slots";
import { acUnitConfigFromAdapter } from "../config.js";
import { evaluateAcUnitFsm } from "./fsm.js";
import {
	evaluateAcCoolingPermission,
	mergeUnitSlotAllocation,
	parseDailyAllocationEntries,
	resolveAcUnitDailyPlanFromData,
	resolveUnitExpectedPower,
	resetAcDailyPlanCache,
} from "./daily_plan.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = slotStartIsoFloored(NOW, TZ);
const SLOT_END = "2026-07-11T10:15:00.000Z";

const UNIT = acUnitConfigFromAdapter(
	{
		ac_u1_enabled: true,
		ac_u1_estimated_power_w: 800,
		ac_u1_on_temp_c: 24.5,
		ac_u1_off_temp_c: 23,
		ac_u1_active_from: "08:00",
		ac_u1_active_until: "19:00",
		ac_u1_hard_off_at: "19:00",
	},
	1,
);

function allocationEntry(
	unitIndex: number,
	allocatedPowerW: number | null,
	status: DailyAllocationEntry["status"] = "allocated",
): DailyAllocationEntry {
	const contributionId = acUnitContributionId(unitIndex);
	return {
		contributionId,
		contributor: addonContributorRef("air_conditioning"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status,
		energySource: "grid",
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: null,
		gridPowerW: allocatedPowerW ?? 0,
		pvPowerW: 0,
		mandatory: false,
		priorityRank: 1,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: "test",
	};
}

function fsmDemandStart() {
	return evaluateAcUnitFsm({
		now: NOW,
		addonEnabled: true,
		unit: UNIT,
		roomTempC: 26,
		roomHumidityPct: 50,
		feedbackSwitchRaw: "off",
		cleaningActive: false,
	});
}

describe("ac daily plan reader", () => {
	it("parses valid allocation JSON", () => {
		const parsed = parseDailyAllocationEntries(JSON.stringify([allocationEntry(1, 800)]));
		assert.ok(parsed);
		assert.equal(parsed!.length, 1);
	});

	it("merges unit slot allocation", () => {
		const merge = mergeUnitSlotAllocation(
			[allocationEntry(1, 900)],
			acUnitContributionId(1),
			SLOT_START,
			SLOT_END,
		);
		assert.equal(merge.valid, true);
		assert.equal(merge.allocatedPowerW, 900);
	});

	it("detects duplicate allocation", () => {
		const merge = mergeUnitSlotAllocation(
			[allocationEntry(1, 500), allocationEntry(1, 500)],
			acUnitContributionId(1),
			SLOT_START,
			SLOT_END,
		);
		assert.equal(merge.valid, false);
	});

	it("separates units 1 and 2", () => {
		const entries = [allocationEntry(1, 700), allocationEntry(2, 600)];
		const u1 = mergeUnitSlotAllocation(entries, acUnitContributionId(1), SLOT_START, SLOT_END);
		const u2 = mergeUnitSlotAllocation(entries, acUnitContributionId(2), SLOT_START, SLOT_END);
		assert.equal(u1.allocatedPowerW, 700);
		assert.equal(u2.allocatedPowerW, 600);
	});

	it("resolves valid allocation", () => {
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const r = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 2, validUntil: null, timezone: TZ },
			entries: [allocationEntry(1, 800)],
			expectedPower: expected,
		});
		assert.equal(r.useDailyPlan, true);
		assert.equal(r.allocationAllowsStart, true);
		assert.equal(r.allocatedPowerW, 800);
	});

	it("zero allocation falls back to climate FSM", () => {
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const r = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [],
			expectedPower: expected,
		});
		assert.equal(r.useDailyPlan, false);
		assert.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
		assert.equal(r.allocationAllowsStart, false);
		assert.match(r.allocationReasonDe, /Climate-Fallback/);
	});

	it("blocks start when allocation below expected power", () => {
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const r = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(1, 500)],
			expectedPower: expected,
		});
		assert.equal(r.useDailyPlan, true);
		assert.equal(r.allocationAllowsStart, false);
		assert.equal(r.dailyPlanStatus, "allocation_below_expected_power");
	});

	it("falls back on wrong date", () => {
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const r = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-10", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(1, 800)],
			expectedPower: expected,
		});
		assert.equal(r.useDailyPlan, false);
		assert.match(r.allocationReasonDe, /Klima-Fallback/);
	});

	it("uses configured power when stats missing", () => {
		const p = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		assert.equal(p.source, "config");
		assert.equal(p.powerW, 800);
		assert.equal(p.valid, true);
	});
});

describe("ac cooling permission", () => {
	it("governance disabled blocks start", () => {
		const fsm = fsmDemandStart();
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const dailyPlan = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(1, 800)],
			expectedPower: expected,
		});
		const perm = evaluateAcCoolingPermission({
			unitEnabled: true,
			governanceEnabled: false,
			addonEnabled: true,
			cleaningActive: false,
			fsm,
			dailyPlan,
			startRetryReady: true,
			stopRetryReady: true,
		});
		assert.equal(perm.decisionSource, "governance_disabled");
		assert.equal(perm.allowStart, false);
		assert.equal(perm.deviceWritesAllowed, false);
	});

	it("daily plan allows start with thermal demand", () => {
		const fsm = fsmDemandStart();
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const dailyPlan = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(1, 800)],
			expectedPower: expected,
		});
		const perm = evaluateAcCoolingPermission({
			unitEnabled: true,
			governanceEnabled: true,
			addonEnabled: true,
			cleaningActive: false,
			fsm,
			dailyPlan,
			startRetryReady: true,
			stopRetryReady: true,
		});
		assert.equal(perm.allowStart, true);
		assert.equal(perm.decisionSource, "daily_plan");
	});

	it("climate fallback on zero allocation with thermal demand", () => {
		const fsm = fsmDemandStart();
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const dailyPlan = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [],
			expectedPower: expected,
		});
		assert.equal(dailyPlan.useDailyPlan, false);
		const perm = evaluateAcCoolingPermission({
			unitEnabled: true,
			governanceEnabled: true,
			addonEnabled: true,
			cleaningActive: false,
			fsm,
			dailyPlan,
			startRetryReady: true,
			stopRetryReady: true,
		});
		assert.equal(perm.allowStart, true);
		assert.equal(perm.decisionSource, "climate_fallback");
	});

	it("climate fallback when plan missing", () => {
		const fsm = fsmDemandStart();
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const dailyPlan = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "not_initialized", date: "", revision: 0, validUntil: null, timezone: TZ },
			entries: [],
			expectedPower: expected,
		});
		assert.equal(dailyPlan.useDailyPlan, false);
		const perm = evaluateAcCoolingPermission({
			unitEnabled: true,
			governanceEnabled: true,
			addonEnabled: true,
			cleaningActive: false,
			fsm,
			dailyPlan,
			startRetryReady: true,
			stopRetryReady: true,
		});
		assert.equal(perm.allowStart, true);
		assert.equal(perm.decisionSource, "climate_fallback");
	});

	it("temperature no demand with positive allocation", () => {
		const fsm = evaluateAcUnitFsm({
			now: NOW,
			addonEnabled: true,
			unit: UNIT,
			roomTempC: 23.5,
			roomHumidityPct: 50,
			feedbackSwitchRaw: "off",
			cleaningActive: false,
		});
		const expected = resolveUnitExpectedPower(UNIT, undefined, NOW.getTime());
		const dailyPlan = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(1, 800)],
			expectedPower: expected,
		});
		const perm = evaluateAcCoolingPermission({
			unitEnabled: true,
			governanceEnabled: true,
			addonEnabled: true,
			cleaningActive: false,
			fsm,
			dailyPlan,
			startRetryReady: true,
			stopRetryReady: true,
		});
		assert.equal(perm.decisionSource, "temperature_no_demand");
		assert.equal(perm.allowStart, false);
	});

	it("resets cache helper", () => {
		resetAcDailyPlanCache();
		assert.ok(true);
	});
});
