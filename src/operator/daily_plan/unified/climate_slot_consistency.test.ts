/**
 * Climate Daily-Plan Slot/Range Consistency — Realfall 11.08.2026.
 * T1–T8 + E2E Forecast→Unified→Dispatch→Runtime.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { acUnitContributionId } from "../../contribution_ids";
import { addonContributorRef } from "../../contributor";
import { mergeWindows } from "../../../beta/product_summary";
import {
	climateUnitTimelineWindowsFromPlanJson,
	collapsePlanVisWindows,
	collectPlanVisSlots,
} from "../../../beta/plan_visibility";
import {
	mergeUnitSlotAllocation,
	resolveAcUnitDailyPlanFromData,
	resolveUnitExpectedPower,
} from "../../../addons/air_conditioning/runtime/daily_plan";
import { acUnitConfigFromAdapter } from "../../../addons/air_conditioning/config";
import type { DailyAllocationEntry } from "../types";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildSlots, energyFromPowerW, powerFromEnergyKwh, SLOT_H } from "./score_allocate";
import {
	unifiedPlanToClimateAllocations,
	buildUnifiedDispatchPublish,
} from "./dispatch_bridge";
import {
	CANONICAL_SLOT_H,
	CANONICAL_SLOT_MS,
	expectedEnergyKwhForPower,
	isCanonicalQuarterSlot,
	isExecutableDailyEntry,
	isExecutableUnifiedCell,
} from "./slot_geometry";
import type { UnifiedAllocationCell, UnifiedDayPlannerInput } from "./types";
import { buildSlots as quarterSlots } from "./fixtures";

const TZ = "Europe/Berlin";
/** 11.08.2026 10:00–14:00 lokal = 08:00Z–12:00Z (CEST). */
const MIDDAY_START = "2026-08-11T08:00:00.000Z";
const MIDDAY_END = "2026-08-11T12:00:00.000Z";
const NOW_1033 = "2026-08-11T08:33:00.000Z";
const SLOT_1030 = "2026-08-11T08:30:00.000Z";
const SLOT_1045 = "2026-08-11T08:45:00.000Z";

const Q = {
	status: "valid" as const,
	confidencePct: 80,
	reasonDe: "test",
};
const FRESH = { observedAtIso: NOW_1033, ageSec: 0, quality: Q };

function climateCell(
	startIso: string,
	endIso: string,
	powerW: number,
	consumerId = "air_conditioning.unit_1",
): UnifiedAllocationCell {
	const energy = expectedEnergyKwhForPower(powerW, CANONICAL_SLOT_H);
	return {
		slot: { startIso, endIso },
		consumerId,
		kind: "climate",
		allocatedPowerW: powerW,
		allocatedEnergyKwh: Math.round(energy * 1000) / 1000,
		energySource: "pv_surplus",
		constraintIds: ["climate.flex"],
		reasonCodes: ["climate_flex"],
	};
}

function realCaseInput(nowIso: string): UnifiedDayPlannerInput {
	const quarters = quarterSlots(MIDDAY_START, 4); // 10:00–14:00 lokal
	const before = quarterSlots("2026-08-11T06:00:00.000Z", 2);
	const after = quarterSlots(MIDDAY_END, 2);
	const slots = [...before, ...quarters, ...after];
	return {
		schemaVersion: 1,
		planIntent: "unified_day",
		time: {
			nowIso,
			timezone: TZ,
			horizonStartIso: slots[0]!.startIso,
			horizonEndIso: slots[slots.length - 1]!.endIso,
			slotMinutes: 15,
			slots: [
				...slots,
				/** Realfall-Gift: Hauslast-Segment mit gleichem startIso wie erster Quarter. */
				{ startIso: MIDDAY_START, endIso: MIDDAY_END },
			],
			freshness: FRESH,
		},
		pv: {
			slots: slots.map((s) => ({
				slot: s,
				forecastPowerW: 4000,
				observedPowerW: null,
				energyKwh: energyFromPowerW(4000),
			})),
			expectedDayEnergyKwh: 40,
			previousExpectedDayEnergyKwh: null,
			biasCorrected: true,
			biasPct: null,
			uncertainty: Q,
			freshness: FRESH,
		},
		houseLoad: {
			slots: [
				{
					slot: { startIso: MIDDAY_START, endIso: MIDDAY_END },
					forecastPowerW: 800,
					observedPowerW: null,
					energyKwh: (800 / 1000) * 4,
				},
			],
			expectedDayEnergyKwh: 12,
			uncertainty: Q,
			freshness: FRESH,
		},
		prices: {
			slots: slots.map((s) => ({
				slot: s,
				importCtPerKwh: 28,
				exportCtPerKwh: 8,
				gridImportAllowed: true,
			})),
			uncertainty: Q,
			freshness: FRESH,
		},
		battery: {
			socPct: 70,
			usableCapacityKwh: 15,
			maxChargePowerW: 5000,
			maxDischargePowerW: 5000,
			minSocPct: 10,
			maxSocPct: 100,
			reserveSocPct: 20,
			nightReserveKwh: null,
			endSocTargetPct: 90,
			requiredChargeEnergyKwh: null,
			chargeDeadlineIso: null,
			gridChargeAllowed: true,
			allowedModes: ["idle", "charge"],
			chargeEfficiency: 0.95,
			dischargeEfficiency: 0.95,
			dischargeLiveSupported: false,
			profileId: "sonnen_em",
			uncertainty: Q,
			freshness: FRESH,
			passiveBatteryEnergyAvailable: false,
		},
		wallbox: null,
		thermal: null,
		climate: {
			units: [
				{
					unitId: "air_conditioning.unit_1",
					label: "Wohnzimmer EG",
					roomTempC: 26,
					comfortMinC: null,
					comfortMaxC: 24,
					targetTempC: 24.5,
					mandatoryComfort: true,
					expectedEnergyKwh: expectedEnergyKwhForPower(850, CANONICAL_SLOT_H) * 4,
					typicalPowerW: 850,
					maxShiftHours: 0,
					uncertainty: Q,
					hardwareRunning: false,
					runtimeHold: false,
					holdPowerW: null,
				},
			],
			freshness: FRESH,
		},
		otherFlex: [],
		globalMode: "balanced",
		preferImmersionLiveSurplusNow: false,
		contributionRevision: 1,
	};
}

describe("climate slot consistency — T1 energy/duration", () => {
	it("T1: 850 W / 15 min → ~0.2125 kWh, Slotdauer 15 min", () => {
		assert.equal(SLOT_H, 0.25);
		assert.equal(CANONICAL_SLOT_H, 0.25);
		const e = energyFromPowerW(850);
		assert.ok(Math.abs(e - 0.2125) < 1e-9);
		const p = powerFromEnergyKwh(e);
		assert.ok(Math.abs(p - 850) < 0.01);
		assert.ok(isCanonicalQuarterSlot(SLOT_1030, SLOT_1045));
		const cell = climateCell(SLOT_1030, SLOT_1045, 850);
		assert.ok(isExecutableUnifiedCell(cell));
		assert.equal(Date.parse(cell.slot.endIso) - Date.parse(cell.slot.startIso), CANONICAL_SLOT_MS);
	});
});

describe("climate slot consistency — T2/T3/T4 display vs execution", () => {
	it("T2: four contiguous quarters → display 1 h / 0.85 kWh; execution stays 4 cells", () => {
		const cells = [
			climateCell("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
			climateCell("2026-08-11T08:15:00.000Z", "2026-08-11T08:30:00.000Z", 850),
			climateCell("2026-08-11T08:30:00.000Z", "2026-08-11T08:45:00.000Z", 850),
			climateCell("2026-08-11T08:45:00.000Z", "2026-08-11T09:00:00.000Z", 850),
		];
		const execBefore = JSON.stringify(cells);
		const windows = mergeWindows(cells, "climate");
		assert.equal(windows.length, 1);
		assert.equal(windows[0]!.startIso, "2026-08-11T08:00:00.000Z");
		assert.equal(windows[0]!.endIso, "2026-08-11T09:00:00.000Z");
		assert.ok(Math.abs(windows[0]!.energyKwh - 0.85) < 0.01);
		assert.equal(JSON.stringify(cells), execBefore, "T4: display must not mutate executable cells");
		assert.equal(cells.length, 4);
	});

	it("T3: non-contiguous slots must not merge into one window", () => {
		const cells = [
			climateCell("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
			climateCell("2026-08-11T08:30:00.000Z", "2026-08-11T08:45:00.000Z", 850),
		];
		const windows = mergeWindows(cells, "climate");
		assert.equal(windows.length, 2);
		const vis = collapsePlanVisWindows(
			collectPlanVisSlots(
				JSON.stringify(
					cells.map((c) => ({
						contributionId: c.consumerId,
						allocatedPowerW: c.allocatedPowerW,
						slot: c.slot,
					})),
				),
				{ nowMs: Date.parse("2026-08-11T07:00:00.000Z") },
			),
		);
		assert.equal(vis.length, 2);
	});

	it("T4: display aggregation does not alter executable allocations", () => {
		const cells = [
			climateCell("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
			climateCell("2026-08-11T08:15:00.000Z", "2026-08-11T08:30:00.000Z", 850),
		];
		const snapshot = structuredClone(cells);
		mergeWindows(cells, "climate");
		climateUnitTimelineWindowsFromPlanJson(
			JSON.stringify(
				cells.map((c) => ({
					contributionId: c.consumerId,
					allocatedPowerW: c.allocatedPowerW,
					slot: c.slot,
				})),
			),
			1,
			Date.parse("2026-08-11T07:00:00.000Z"),
		);
		assert.deepEqual(cells, snapshot);
	});
});

describe("climate slot consistency — T5/T6 runtime match", () => {
	const unit = acUnitConfigFromAdapter(
		{
			ac_u1_enabled: true,
			ac_u1_estimated_power_w: 850,
			ac_u1_on_temp_c: 24.5,
			ac_u1_off_temp_c: 23,
			ac_u1_active_from: "08:00",
			ac_u1_active_until: "20:00",
			ac_u1_hard_off_at: "20:00",
		},
		1,
	);

	function entry(start: string, end: string, w: number): DailyAllocationEntry {
		return {
			contributionId: acUnitContributionId(1),
			contributor: addonContributorRef("air_conditioning"),
			slot: { startIso: start, endIso: end },
			status: "allocated",
			energySource: "pv_surplus",
			requestedPowerW: w,
			allocatedPowerW: w,
			requestedEnergyKwh: expectedEnergyKwhForPower(w, CANONICAL_SLOT_H),
			allocatedEnergyKwh: expectedEnergyKwhForPower(w, CANONICAL_SLOT_H),
			gridPowerW: 0,
			pvPowerW: w,
			batteryPowerW: 0,
			mandatory: true,
			priorityRank: null,
			deadlineIso: null,
			estimatedCostCt: null,
			reasonDe: "test",
		};
	}

	it("T5: NOW=10:33 finds exact 10:30–10:45 allocation", () => {
		const now = new Date(NOW_1033);
		const expected = resolveUnitExpectedPower(unit, undefined, now.getTime());
		const r = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now,
			timezone: TZ,
			meta: {
				status: "ready",
				date: "2026-08-11",
				revision: 1,
				validUntil: null,
				timezone: TZ,
			},
			entries: [entry(SLOT_1030, SLOT_1045, 850)],
			expectedPower: expected,
		});
		assert.equal(r.slotStartIso, SLOT_1030);
		assert.equal(r.slotEndIso, SLOT_1045);
		assert.equal(r.allocatedPowerW, 850);
		assert.equal(r.dailyPlanStatus, "daily_plan_valid");
		assert.equal(r.allocationAllowsStart, true);
	});

	it("T6: missing 10:30–10:45 → 0 W Planner-OFF; display not continuous over gap", () => {
		const now = new Date(NOW_1033);
		const expected = resolveUnitExpectedPower(unit, undefined, now.getTime());
		const r = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now,
			timezone: TZ,
			meta: {
				status: "ready",
				date: "2026-08-11",
				revision: 1,
				validUntil: null,
				timezone: TZ,
			},
			entries: [
				entry("2026-08-11T08:00:00.000Z", "2026-08-11T08:15:00.000Z", 850),
				entry("2026-08-11T09:00:00.000Z", "2026-08-11T09:15:00.000Z", 850),
			],
			expectedPower: expected,
		});
		assert.equal(r.allocatedPowerW, 0);
		assert.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
		assert.match(r.allocationReasonDe, /Planner-OFF/);

		const planJson = JSON.stringify([
			{
				contributionId: acUnitContributionId(1),
				allocatedPowerW: 850,
				slot: { startIso: "2026-08-11T08:00:00.000Z", endIso: "2026-08-11T08:15:00.000Z" },
			},
			{
				contributionId: acUnitContributionId(1),
				allocatedPowerW: 850,
				slot: { startIso: "2026-08-11T09:00:00.000Z", endIso: "2026-08-11T09:15:00.000Z" },
			},
		]);
		const wins = climateUnitTimelineWindowsFromPlanJson(planJson, 1, Date.parse("2026-08-11T07:50:00.000Z"));
		assert.equal(wins.length, 2);
		assert.ok(!wins.some((w) => w.startMs <= Date.parse(SLOT_1030) && w.endMs > Date.parse(SLOT_1030)));
	});
});

describe("climate slot consistency — T7 realfall midday overwrite", () => {
	it("T7: house midday 10–14 must not create 4h@850W@0.213 executable slot", () => {
		const input = realCaseInput(NOW_1033);
		const work = buildSlots(input);
		assert.ok(work.length > 0);
		for (const s of work) {
			assert.ok(
				isCanonicalQuarterSlot(s.startIso, s.endIso),
				`non-canonical executable slot ${s.startIso}–${s.endIso}`,
			);
		}
		const midday = work.find((s) => s.startIso === MIDDAY_START);
		assert.ok(midday);
		assert.equal(midday!.endIso, "2026-08-11T08:15:00.000Z");

		const plan = allocateUnifiedDayPlan(input);
		for (const a of plan.allocations) {
			assert.ok(
				isCanonicalQuarterSlot(a.slot.startIso, a.slot.endIso),
				`allocation non-canonical ${a.consumerId} ${a.slot.startIso}–${a.slot.endIso}`,
			);
			assert.ok(isExecutableUnifiedCell(a), `energy/power invariant failed for ${a.consumerId}`);
		}

		const climate = plan.allocations.filter((a) => a.kind === "climate");
		const bad = climate.find(
			(a) =>
				a.slot.startIso === MIDDAY_START &&
				a.slot.endIso === MIDDAY_END &&
				Math.abs(a.allocatedEnergyKwh - 0.213) < 0.01,
		);
		assert.equal(bad, undefined, "realfall malformed 4h/0.213 climate allocation must not exist");

		const pub = unifiedPlanToClimateAllocations(plan);
		assert.ok(pub.every(isExecutableDailyEntry));
		assert.ok(
			!pub.some(
				(e) =>
					e.slot.startIso === MIDDAY_START &&
					e.slot.endIso === MIDDAY_END &&
					(e.allocatedEnergyKwh ?? 0) < 0.3,
			),
		);

		/** Dispatch rejects an artificially injected multi-hour leak. */
		const leakPlan = {
			...plan,
			allocations: [
				...plan.allocations,
				{
					slot: { startIso: MIDDAY_START, endIso: MIDDAY_END },
					consumerId: "air_conditioning.unit_1",
					kind: "climate" as const,
					allocatedPowerW: 850,
					allocatedEnergyKwh: 0.213,
					energySource: "pv_surplus" as const,
					constraintIds: ["climate.flex"],
					reasonCodes: ["leak"],
				},
			],
		};
		const filtered = unifiedPlanToClimateAllocations(leakPlan);
		assert.ok(
			!filtered.some((e) => e.slot.endIso === MIDDAY_END && e.slot.startIso === MIDDAY_START),
			"dispatch must drop multi-hour climate leak",
		);
	});
});

describe("climate slot consistency — T8 replan geometry", () => {
	it("T8: replan keeps current-slot climate key → no geometry-induced OFF", () => {
		const input1 = realCaseInput("2026-08-11T08:32:00.000Z");
		const plan1 = allocateUnifiedDayPlan(input1);
		const pub1 = unifiedPlanToClimateAllocations(plan1);
		const current = pub1.find((e) => e.slot.startIso === SLOT_1030);
		assert.ok(current, "first plan must allocate current 10:30 slot when climate demand exists");
		assert.equal(current!.slot.endIso, SLOT_1045);
		assert.ok((current!.allocatedPowerW ?? 0) >= 50);

		const input2 = realCaseInput("2026-08-11T08:34:00.000Z");
		const plan2 = allocateUnifiedDayPlan(input2, { previousPlan: plan1, generation: 2 });
		const pub2 = unifiedPlanToClimateAllocations(plan2);
		const again = pub2.find((e) => e.slot.startIso === SLOT_1030);
		assert.ok(again, "replan must still expose canonical 10:30–10:45 key");
		assert.equal(again!.slot.endIso, SLOT_1045);

		const merge = mergeUnitSlotAllocation(
			pub2,
			acUnitContributionId(1),
			SLOT_1030,
			SLOT_1045,
		);
		assert.equal(merge.valid, true);
		assert.ok(merge.allocatedPowerW > 0, "runtime must still match after replan");
	});
});

describe("climate slot consistency — Klima-/Ownership-Block: Hard-Off reicht bis in den Unified Planner", () => {
	it("hardStopMs (echte Hard-Off-Zeit) verhindert Allocation an/nach der Zwangsabschaltung", () => {
		const input = realCaseInput(NOW_1033);
		// Hard-Off um 09:15Z (11:15 lokal) — mitten im geplanten Horizont (06:00–14:15Z).
		const hardStopIso = "2026-08-11T09:15:00.000Z";
		const withHardOff: UnifiedDayPlannerInput = {
			...input,
			climate: {
				...input.climate!,
				units: input.climate!.units.map((u) => ({ ...u, hardStopMs: Date.parse(hardStopIso) })),
			},
		};
		const plan = allocateUnifiedDayPlan(withHardOff);
		const climate = plan.allocations.filter((a) => a.kind === "climate");
		const afterHardOff = climate.find(
			(a) => Date.parse(a.slot.startIso) >= Date.parse(hardStopIso) && (a.allocatedPowerW ?? 0) > 0,
		);
		assert.equal(afterHardOff, undefined, "keine Allocation an/nach der konfigurierten Hard-Off-Zeit");
		assert.ok(
			climate.some((a) => Date.parse(a.slot.startIso) < Date.parse(hardStopIso) && (a.allocatedPowerW ?? 0) > 0),
			"vor Hard-Off bleibt Allocation weiterhin möglich",
		);
	});
});

describe("climate slot consistency — E2E system invariant", () => {
	it("Forecast segment mix → Unified quarters → Dispatch → Runtime match at 10:33", () => {
		const input = realCaseInput(NOW_1033);
		const work = buildSlots(input);
		assert.ok(work.every((s) => isCanonicalQuarterSlot(s.startIso, s.endIso)));

		const plan = allocateUnifiedDayPlan(input);
		const pub = buildUnifiedDispatchPublish(plan);
		assert.ok(pub.climateEntries.every(isExecutableDailyEntry));

		const now = new Date(NOW_1033);
		const unit = acUnitConfigFromAdapter(
			{
				ac_u1_enabled: true,
				ac_u1_estimated_power_w: 850,
				ac_u1_on_temp_c: 24.5,
				ac_u1_off_temp_c: 23,
				ac_u1_active_from: "08:00",
				ac_u1_active_until: "20:00",
				ac_u1_hard_off_at: "20:00",
			},
			1,
		);
		const expected = resolveUnitExpectedPower(unit, undefined, now.getTime());
		const r = resolveAcUnitDailyPlanFromData({
			unitIndex: 1,
			now,
			timezone: TZ,
			meta: {
				status: "ready",
				date: "2026-08-11",
				revision: 1,
				validUntil: null,
				timezone: TZ,
			},
			entries: pub.climateEntries,
			expectedPower: expected,
		});
		assert.equal(r.slotStartIso, SLOT_1030);
		assert.equal(r.slotEndIso, SLOT_1045);
		if (pub.climateEntries.some((e) => e.slot.startIso === SLOT_1030)) {
			assert.ok((r.allocatedPowerW ?? 0) > 0);
			assert.equal(r.dailyPlanStatus, "daily_plan_valid");
		} else {
			assert.equal(r.allocatedPowerW, 0);
			assert.equal(r.dailyPlanStatus, "daily_plan_zero_allocation");
		}
	});
});
