import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../../operator/contribution_ids";
import { addonContributorRef } from "../../../operator/contributor";
import type { DailyAllocationEntry } from "../../../operator/daily_plan/types";
import { slotStartIsoFloored } from "../../../operator/daily_plan/slots";
import { immersionDeviceConfigFromAdapter } from "../device_config.js";
import {
	mergeSlotAllocations,
	parseDailyAllocationEntries,
	isImmersionAllocationSummaryAuthoritative,
	resolveImmersionDailyPlanAllocation,
	resolveImmersionDailyPlanFromData,
	resolveImmersionDecisionSource,
	stageIndexForMaxPowerW,
	resetImmersionDailyPlanCache,
} from "./daily_plan.js";
import { ALLOCATION_ADDON_STATE_IDS, DAILY_PLAN_STATE_IDS } from "../../../operator/daily_plan/states";

const TZ = "UTC";
const NOW = new Date("2026-07-11T10:07:00.000Z");
const SLOT_START = slotStartIsoFloored(NOW, TZ);
const SLOT_END = "2026-07-11T10:15:00.000Z";

const MULTI_STAGE_CFG = immersionDeviceConfigFromAdapter({
	ih_stage_count: 3,
	ih_stage_1_nominal_power_w: 1700,
	ih_stage_2_nominal_power_w: 3400,
	ih_stage_3_nominal_power_w: 5100,
	ih_stage_1_set_state: "s1",
	ih_stage_2_set_state: "s2",
	ih_stage_3_set_state: "s3",
	ih_stage_1_enabled: true,
	ih_stage_2_enabled: true,
	ih_stage_3_enabled: true,
});

function allocationEntry(
	contributionId: string,
	allocatedPowerW: number | null,
	status: DailyAllocationEntry["status"] = "allocated",
): DailyAllocationEntry {
	return {
		contributionId,
		contributor: addonContributorRef("immersion_heater"),
		slot: { startIso: SLOT_START, endIso: SLOT_END },
		status,
		energySource: "pv_surplus",
		requestedPowerW: allocatedPowerW,
		allocatedPowerW,
		requestedEnergyKwh: null,
		allocatedEnergyKwh: null,
		gridPowerW: 0,
		pvPowerW: allocatedPowerW ?? 0,
		mandatory: contributionId === CONTRIBUTION_IDS.IMMERSION_MANDATORY,
		priorityRank: 1,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: "test",
	};
}

describe("immersion daily plan reader", () => {
	it("parses valid allocation JSON array", () => {
		const raw = [allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1700)];
		const parsed = parseDailyAllocationEntries(JSON.stringify(raw));
		assert.ok(parsed);
		assert.equal(parsed!.length, 1);
	});

	it("rejects invalid JSON", () => {
		assert.equal(parseDailyAllocationEntries("{bad"), null);
	});

	it("rejects non-array JSON", () => {
		assert.equal(parseDailyAllocationEntries({}), null);
	});

	it("merges mandatory and flexible without double counting", () => {
		const merge = mergeSlotAllocations(
			[
				allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1000),
				allocationEntry(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 700),
			],
			SLOT_START,
			SLOT_END,
		);
		assert.equal(merge.valid, true);
		assert.equal(merge.mandatoryPowerW, 1000);
		assert.equal(merge.flexiblePowerW, 700);
		assert.equal(merge.totalPowerW, 1700);
	});

	it("detects duplicate slot allocation", () => {
		const merge = mergeSlotAllocations(
			[
				allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1000),
				allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, 500),
			],
			SLOT_START,
			SLOT_END,
		);
		assert.equal(merge.valid, false);
		assert.match(merge.reasonDe, /Doppelte/);
	});

	it("ignores inactive allocation statuses", () => {
		const merge = mergeSlotAllocations(
			[allocationEntry(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 2000, "unallocated")],
			SLOT_START,
			SLOT_END,
		);
		assert.equal(merge.totalPowerW, 0);
		assert.equal(merge.allocationStatus, "none");
	});

	it("rejects null and negative allocation power", () => {
		assert.equal(
			mergeSlotAllocations(
				[allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, null)],
				SLOT_START,
				SLOT_END,
			).valid,
			false,
		);
		assert.equal(
			mergeSlotAllocations(
				[allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, -100)],
				SLOT_START,
				SLOT_END,
			).valid,
			false,
		);
	});

	it("accepts valid zero allocation", () => {
		const merge = mergeSlotAllocations([], SLOT_START, SLOT_END);
		assert.equal(merge.valid, true);
		assert.equal(merge.totalPowerW, 0);
	});

	it("selects highest stage within allocation cap", () => {
		assert.equal(stageIndexForMaxPowerW(MULTI_STAGE_CFG, 1700).stageIndex, 1);
		assert.equal(stageIndexForMaxPowerW(MULTI_STAGE_CFG, 2000).stageIndex, 1);
		assert.equal(stageIndexForMaxPowerW(MULTI_STAGE_CFG, 3400).stageIndex, 2);
		assert.equal(stageIndexForMaxPowerW(MULTI_STAGE_CFG, 5000).stageIndex, 2);
		assert.equal(stageIndexForMaxPowerW(MULTI_STAGE_CFG, 5100).stageIndex, 3);
	});

	it("returns stage 0 when allocation below smallest stage", () => {
		const pick = stageIndexForMaxPowerW(MULTI_STAGE_CFG, 500);
		assert.equal(pick.stageIndex, 0);
		assert.match(pick.reasonDe, /kleiner als kleinste Stufe/);
	});

	it("resolves valid daily plan with positive allocation", () => {
		const r = resolveImmersionDailyPlanFromData({
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 3, validUntil: null, timezone: TZ },
			entries: [allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, 3400)],
			config: MULTI_STAGE_CFG,
		});
		assert.equal(r.useDailyPlan, true);
		assert.equal(r.dailyPlanStatus, "daily_plan_valid");
		assert.equal(r.commandedStage, 2);
		assert.equal(r.allocatedPowerW, 3400);
		assert.equal(r.mandatoryAllocatedPowerW, 3400);
	});

	it("resolves valid daily plan with zero allocation without fallback flag", () => {
		const r = resolveImmersionDailyPlanFromData({
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [],
			config: MULTI_STAGE_CFG,
		});
		assert.equal(r.useDailyPlan, true);
		assert.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
		assert.equal(r.commandedStage, 0);
		assert.equal(r.decisionSource, "daily_plan");
	});

	it("falls back on wrong date", () => {
		const r = resolveImmersionDailyPlanFromData({
			now: NOW,
			timezone: TZ,
			meta: { status: "ready", date: "2026-07-10", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1700)],
			config: MULTI_STAGE_CFG,
		});
		assert.equal(r.useDailyPlan, false);
		assert.equal(r.dailyPlanStatus, "daily_plan_wrong_date");
		assert.match(r.allocationReasonDe, /Thermal-Fallback/);
	});

	it("falls back on expired plan", () => {
		const r = resolveImmersionDailyPlanFromData({
			now: NOW,
			timezone: TZ,
			meta: {
				status: "ready",
				date: "2026-07-11",
				revision: 1,
				validUntil: "2026-07-11T09:00:00.000Z",
				timezone: TZ,
			},
			entries: [allocationEntry(CONTRIBUTION_IDS.IMMERSION_MANDATORY, 1700)],
			config: MULTI_STAGE_CFG,
		});
		assert.equal(r.useDailyPlan, false);
		assert.equal(r.dailyPlanStatus, "daily_plan_expired");
	});

	it("falls back on invalid plan status", () => {
		const r = resolveImmersionDailyPlanFromData({
			now: NOW,
			timezone: TZ,
			meta: { status: "error", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [],
			config: MULTI_STAGE_CFG,
		});
		assert.equal(r.useDailyPlan, false);
		assert.equal(r.dailyPlanStatus, "daily_plan_invalid");
	});

	it("accepts degraded plan status", () => {
		const r = resolveImmersionDailyPlanFromData({
			now: NOW,
			timezone: TZ,
			meta: { status: "degraded", date: "2026-07-11", revision: 1, validUntil: null, timezone: TZ },
			entries: [allocationEntry(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700)],
			config: MULTI_STAGE_CFG,
		});
		assert.equal(r.useDailyPlan, true);
		assert.equal(r.flexibleAllocatedPowerW, 1700);
	});

	it("rejects unknown contribution in merge path via invalid allocation", () => {
		const bad = allocationEntry("wallbox.ev_session", 1000);
		const merge = mergeSlotAllocations([bad], SLOT_START, SLOT_END);
		assert.equal(merge.totalPowerW, 0);
	});

	it("decision source priority mapping", () => {
		assert.equal(resolveImmersionDecisionSource("off", false, false, "off", "daily_plan"), "manual_off");
		assert.equal(resolveImmersionDecisionSource("force", false, false, "force_heating", "daily_plan"), "manual_force");
		assert.equal(resolveImmersionDecisionSource("auto", true, false, "off", "daily_plan"), "safety");
		assert.equal(resolveImmersionDecisionSource("auto", false, true, "fault_lockout", "daily_plan"), "lockout");
		assert.equal(resolveImmersionDecisionSource("auto", false, true, "off", "daily_plan"), "fault");
		assert.equal(resolveImmersionDecisionSource("auto", false, false, "auto_heating", "daily_plan"), "daily_plan");
		assert.equal(resolveImmersionDecisionSource("auto", false, false, "auto_heating", "thermal_fallback"), "thermal_fallback");
	});

	it("resets cache helper", () => {
		resetImmersionDailyPlanCache();
		assert.ok(true);
	});

	it("reads allocation summary without loading full daily plan when immersion entries exist", async () => {
		resetImmersionDailyPlanCache();
		const reads: string[] = [];
		const allocation = [allocationEntry(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, 1700)];
		const host = {
			config: { timezone: TZ },
			async getStateAsync(id: string) {
				reads.push(id);
				if (id === DAILY_PLAN_STATE_IDS.status) return { val: "ready", ack: true };
				if (id === DAILY_PLAN_STATE_IDS.date) return { val: "2026-07-11", ack: true };
				if (id === DAILY_PLAN_STATE_IDS.revision) return { val: 3, ack: true };
				if (id === DAILY_PLAN_STATE_IDS.validUntil) return { val: "", ack: true };
				if (id === ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson) {
					return { val: JSON.stringify(allocation), ack: true };
				}
				if (id === DAILY_PLAN_STATE_IDS.planJson) {
					throw new Error("full plan must not be read");
				}
				return null;
			},
		};

		const result = await resolveImmersionDailyPlanAllocation(
			host as Parameters<typeof resolveImmersionDailyPlanAllocation>[0],
			MULTI_STAGE_CFG,
			NOW,
		);
		assert.equal(result.useDailyPlan, true);
		assert.ok(!reads.includes(DAILY_PLAN_STATE_IDS.planJson));
	});

	it("valid authoritative allocation without immersion entries means zero allocation", async () => {
		resetImmersionDailyPlanCache();
		const reads: string[] = [];
		const host = {
			config: { timezone: TZ },
			async getStateAsync(id: string) {
				reads.push(id);
				if (id === DAILY_PLAN_STATE_IDS.status) return { val: "ready", ack: true };
				if (id === DAILY_PLAN_STATE_IDS.date) return { val: "2026-07-11", ack: true };
				if (id === DAILY_PLAN_STATE_IDS.revision) return { val: 2, ack: true };
				if (id === DAILY_PLAN_STATE_IDS.validUntil) return { val: "", ack: true };
				if (id === ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson) {
					return { val: "[]", ack: true };
				}
				if (id === DAILY_PLAN_STATE_IDS.planJson) {
					throw new Error("full plan must not be read for authoritative empty allocation");
				}
				return null;
			},
		};

		const result = await resolveImmersionDailyPlanAllocation(
			host as Parameters<typeof resolveImmersionDailyPlanAllocation>[0],
			MULTI_STAGE_CFG,
			NOW,
		);
		assert.equal(result.dailyPlanStatus, "daily_plan_zero_allocation");
		assert.equal(result.useDailyPlan, true);
		assert.equal(result.allocatedPowerW, 0);
		assert.ok(!reads.includes(DAILY_PLAN_STATE_IDS.planJson));
	});

	it("invalid allocation schema falls back to full daily plan read", async () => {
		resetImmersionDailyPlanCache();
		const reads: string[] = [];
		const host = {
			config: { timezone: TZ },
			async getStateAsync(id: string) {
				reads.push(id);
				if (id === DAILY_PLAN_STATE_IDS.status) return { val: "ready", ack: true };
				if (id === DAILY_PLAN_STATE_IDS.date) return { val: "2026-07-11", ack: true };
				if (id === DAILY_PLAN_STATE_IDS.revision) return { val: 2, ack: true };
				if (id === DAILY_PLAN_STATE_IDS.validUntil) return { val: "", ack: true };
				if (id === ALLOCATION_ADDON_STATE_IDS.immersion_heater.planJson) {
					return { val: "{not-an-array}", ack: true };
				}
				if (id === DAILY_PLAN_STATE_IDS.planJson) {
					return { val: "{}", ack: true };
				}
				return null;
			},
		};

		await resolveImmersionDailyPlanAllocation(
			host as Parameters<typeof resolveImmersionDailyPlanAllocation>[0],
			MULTI_STAGE_CFG,
			NOW,
		);
		assert.ok(reads.includes(DAILY_PLAN_STATE_IDS.planJson));
	});

	it("allocation summary authority requires usable status, date and revision", () => {
		const now = NOW;
		const meta = {
			status: "ready",
			date: "2026-07-11",
			revision: 2,
			validUntil: null as string | null,
			timezone: TZ,
		};
		assert.equal(isImmersionAllocationSummaryAuthoritative(meta, now, []), true);
		assert.equal(
			isImmersionAllocationSummaryAuthoritative({ ...meta, status: "missing_inputs" }, now, []),
			false,
		);
		assert.equal(isImmersionAllocationSummaryAuthoritative({ ...meta, date: "2026-07-10" }, now, []), false);
		assert.equal(isImmersionAllocationSummaryAuthoritative({ ...meta, revision: 0 }, now, []), false);
		assert.equal(isImmersionAllocationSummaryAuthoritative(meta, now, null), false);
	});
});
