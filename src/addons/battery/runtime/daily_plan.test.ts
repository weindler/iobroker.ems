import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import type { DailyAllocationEntry } from "../../../operator/daily_plan/types";
import { slotStartIsoFloored, DAILY_PLAN_SLOT_MS } from "../../../operator/daily_plan/slots";
import { isoFromMs } from "../../../operator/time";
import { getBatteryProfile } from "../profiles/registry.js";
import {
	deviceIntentFromDailyPlan,
	isBatteryDailyPlanAuthoritative,
	mergeBatteryChargeSlotAllocation,
	parseDailyAllocationEntries,
	resetBatteryDailyPlanCache,
	resolveBatteryDailyPlanFromData,
} from "./daily_plan.js";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = slotStartIsoFloored(NOW, TZ);
const SLOT_END = isoFromMs(Date.parse(SLOT_START) + DAILY_PLAN_SLOT_MS);
const PROFILE = getBatteryProfile("sonnen_em");
const LIMITS = {
	maxChargeW: 5000,
	maxDischargeW: 5000,
	minSocPct: 5,
	maxSocPct: 100,
	valid: true,
	issues: [] as string[],
};

function allocationEntry(
	allocatedPowerW: number | null,
	status: DailyAllocationEntry["status"] = "allocated",
	over: Partial<DailyAllocationEntry> = {},
): DailyAllocationEntry {
	return {
		contributionId: CONTRIBUTION_IDS.BATTERY_CHARGE,
		contributor: addonContributorRef("battery"),
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
		...over,
	};
}

function resolve(entries: DailyAllocationEntry[], over: Partial<Parameters<typeof resolveBatteryDailyPlanFromData>[0]> = {}) {
	return resolveBatteryDailyPlanFromData({
		now: NOW,
		timezone: TZ,
		meta: { status: "ready", date: "2026-07-11", revision: 3, validUntil: null, timezone: TZ },
		entries,
		dischargePresent: false,
		profile: PROFILE,
		limits: LIMITS,
		socPct: 50,
		topOffActive: false,
		targetSocFromIntent: null,
		governanceEnabled: true,
		...over,
	});
}

describe("battery daily plan reader", () => {
	beforeEach(() => resetBatteryDailyPlanCache());

	it("parses valid allocation JSON", () => {
		const parsed = parseDailyAllocationEntries(JSON.stringify([allocationEntry(3000)]));
		assert.ok(parsed);
		assert.equal(parsed!.length, 1);
	});

	it("rejects invalid JSON", () => {
		assert.equal(parseDailyAllocationEntries("{bad"), null);
	});

	it("detects duplicate allocation", () => {
		const merge = mergeBatteryChargeSlotAllocation(
			[allocationEntry(2000), allocationEntry(1000)],
			SLOT_START,
			SLOT_END,
		);
		assert.equal(merge.valid, false);
	});

	it("ignores battery.discharge entries", () => {
		const discharge = allocationEntry(1000);
		discharge.contributionId = CONTRIBUTION_IDS.BATTERY_DISCHARGE;
		const r = resolve([discharge, allocationEntry(0, "unallocated")], { dischargePresent: true });
		assert.equal(r.dailyPlanAuthoritative, true);
		assert.equal(r.chargingAllowed, false);
		assert.equal(r.dischargeIgnored, true);
	});

	it("rejects negative power", () => {
		const r = resolve([allocationEntry(-500)]);
		assert.equal(r.chargingAllowed, false);
		assert.equal(r.dailyPlanAuthoritative, true);
	});

	it("valid zero allocation is authoritative without fallback", () => {
		const r = resolve([]);
		assert.equal(r.useDailyPlan, true);
		assert.equal(r.dailyPlanAuthoritative, true);
		assert.equal(r.chargingAllowed, false);
		assert.equal(r.legacyFallbackActive, false);
		assert.equal(r.dailyPlanBlocksGridBalance, true);
		assert.equal(isBatteryDailyPlanAuthoritative(r), true);
	});

	it("unallocated status yields no charge", () => {
		const r = resolve([allocationEntry(3000, "unallocated")]);
		assert.equal(r.chargingAllowed, false);
		assert.equal(r.dailyPlanAuthoritative, true);
	});

	it("allows allocated charge within limits", () => {
		const r = resolve([allocationEntry(3000)]);
		assert.equal(r.chargingAllowed, true);
		assert.equal(r.effectiveChargePowerW, 3000);
		assert.equal(r.decisionSource, "daily_plan");
	});

	it("caps allocation above hardware max", () => {
		const r = resolve([allocationEntry(8000)]);
		assert.equal(r.effectiveChargePowerW, 5000);
		assert.equal(r.chargePowerCapped, true);
	});

	it("falls back on wrong date", () => {
		const r = resolve([allocationEntry(3000)], {
			meta: { status: "ready", date: "2026-07-10", revision: 1, validUntil: null, timezone: TZ },
		});
		assert.equal(r.useDailyPlan, false);
		assert.equal(r.legacyFallbackActive, true);
	});

	it("blocks charge at target soc", () => {
		const r = resolve([allocationEntry(3000)], { socPct: 95, targetSocFromIntent: 90 });
		assert.equal(r.dailyPlanStatus, "soc_at_target");
		assert.equal(r.chargingAllowed, false);
	});

	it("maps device intent for grid allocation", () => {
		const ctx = resolve([allocationEntry(2500, "allocated", { energySource: "grid", gridPowerW: 2500 })]);
		const intent = deviceIntentFromDailyPlan(ctx, NOW.getTime());
		assert.equal(intent.action, "grid_charge");
		assert.equal(intent.maxChargeW, 2500);
		assert.equal(intent.source, "daily_plan");
	});

	it("maps zero allocation to self_consumption intent", () => {
		const ctx = resolve([]);
		const intent = deviceIntentFromDailyPlan(ctx, NOW.getTime());
		assert.equal(intent.action, "self_consumption");
		assert.equal(intent.maxChargeW, 0);
	});
});

describe("battery daily plan priority signals", () => {
	it("authoritative plan blocks legacy fallback flag", () => {
		const r = resolve([allocationEntry(0)]);
		assert.equal(r.legacyFallbackActive, false);
		assert.equal(r.dailyPlanBlocksGridBalance, true);
	});

	it("invalid plan enables legacy fallback", () => {
		const r = resolve([allocationEntry(3000)], {
			meta: { status: "error", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
		});
		assert.equal(r.useDailyPlan, false);
		assert.equal(r.legacyFallbackActive, true);
	});
});
