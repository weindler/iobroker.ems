import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCompareResult } from "./build.js";
import type { DailyAllocationEntry, DailyPlan, DailyPlanSlot } from "../../operator/daily_plan/types.js";
import type { AiSlotPreference } from "../types.js";

const T1 = "2026-07-25T10:00:00.000Z";
const T2 = "2026-07-25T10:15:00.000Z";

function allocation(
	overrides: Partial<DailyAllocationEntry> & { contributionId: string; slotStart: string },
): DailyAllocationEntry {
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
		gridPowerW: rest.gridPowerW ?? 0,
		pvPowerW: rest.pvPowerW ?? 0,
		mandatory: rest.mandatory ?? false,
		priorityRank: 1,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: "",
		...rest,
	};
}

function slot(overrides: Partial<DailyPlanSlot> & { startIso: string }): DailyPlanSlot {
	const allocations = overrides.allocations ?? [];
	return {
		slot: { startIso: overrides.startIso, endIso: overrides.startIso },
		pvForecastPowerW: null,
		fixedHouseLoadPowerW: null,
		fixedBalancePowerW: null,
		gridPriceCtPerKwh: overrides.gridPriceCtPerKwh ?? 30,
		gridImportAllowed: overrides.gridImportAllowed ?? true,
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

function minimalPlan(slots: DailyPlanSlot[]): DailyPlan {
	return {
		generatedAt: "2026-07-25T09:00:00.000Z",
		validUntil: null,
		revision: 7,
		date: "2026-07-25",
		timezone: "Europe/Berlin",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: [],
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
			flexibleUnallocatedEnergyKwh: 0.5,
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
		reasonDe: "Testplan",
	};
}

describe("buildCompareResult", () => {
	it("no eligible add-on allowed → Plan B is identical to Plan A, activePlan=a", () => {
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 400,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [allocation({ contributionId: "immersion_heater.flexible", slotStart: T1, allocatedPowerW: 400, gridPowerW: 400 })],
			}),
		]);
		const result = buildCompareResult(plan, [], []);
		assert.deepEqual(result.chartB, result.chartA);
		assert.equal(result.delta.activePlan, "a");
		assert.deepEqual(result.delta.aiInvolvedAddonIds, []);
		assert.equal(result.delta.deltaCostCt, 0);
	});

	it("without any AI slot preferences, Plan B reproduces Plan A even when the add-on is allowed", () => {
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 400,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [allocation({ contributionId: "immersion_heater.flexible", slotStart: T1, allocatedPowerW: 400, gridPowerW: 400 })],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 10,
				availablePvSurplusPowerW: 1000,
				remainingPvSurplusPowerW: 1000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const result = buildCompareResult(plan, ["immersion_heater"], []);
		assert.deepEqual(result.chartB, result.chartA);
		assert.equal(result.delta.activePlan, "a");
	});

	it("shifts flexible immersion-heater energy toward a cheap/PV-rich slot the AI prefers, lowering cost", () => {
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 400,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [allocation({ contributionId: "immersion_heater.flexible", slotStart: T1, allocatedPowerW: 400, gridPowerW: 400 })],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 10,
				availablePvSurplusPowerW: 1000,
				remainingPvSurplusPowerW: 1000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const slotPreferences: AiSlotPreference[] = [
			{ addonId: "immersion_heater", slotStartIso: T1, weight: 0.2 },
			{ addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
		];
		const result = buildCompareResult(plan, ["immersion_heater"], slotPreferences);

		// Energy conservation: total ih kWh must stay identical between A and B.
		assert.ok(Math.abs(result.delta.planA.ihKwh - result.delta.planB.ihKwh) < 1e-6);
		// Plan B must have moved meaningful energy into the cheaper/PV-rich slot.
		assert.ok(result.chartB[1].ihW > result.chartA[1].ihW);
		assert.ok(result.chartB[0].ihW < result.chartA[0].ihW);
		// Cheaper overall → Plan B wins.
		assert.ok(result.delta.planB.costCt < result.delta.planA.costCt);
		assert.equal(result.delta.activePlan, "b");
		assert.deepEqual(result.delta.aiInvolvedAddonIds, ["immersion_heater"]);
		// Unallocated flexible energy is untouched by a pure timing shift.
		assert.equal(result.delta.planA.unallocatedKwh, result.delta.planB.unallocatedKwh);
	});

	it("never touches mandatory allocations (e.g. anti-legionella) even with strong AI preferences elsewhere", () => {
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 200,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({ contributionId: "immersion_heater.mandatory", slotStart: T1, allocatedPowerW: 200, gridPowerW: 200, mandatory: true }),
				],
			}),
			slot({ startIso: T2, gridPriceCtPerKwh: 10, availablePvSurplusPowerW: 1000, remainingPvSurplusPowerW: 1000, remainingGridImportPowerWAfterAlloc: 5000 }),
		]);
		const slotPreferences: AiSlotPreference[] = [{ addonId: "immersion_heater", slotStartIso: T2, weight: 3 }];
		const result = buildCompareResult(plan, ["immersion_heater"], slotPreferences);
		assert.equal(result.chartA[0].ihW, 0);
		assert.equal(result.chartB[0].ihW, 0);
	});

	it("shifts battery.charge toward cheap slot when battery AI allowed; leaves discharge untouched", () => {
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 1500,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({
						contributionId: "battery.charge",
						slotStart: T1,
						allocatedPowerW: 1000,
						gridPowerW: 1000,
						contributor: { type: "addon", id: "battery", addonId: "battery" },
					}),
					allocation({
						contributionId: "battery.discharge",
						slotStart: T1,
						allocatedPowerW: 500,
						gridPowerW: 0,
						pvPowerW: 0,
						contributor: { type: "addon", id: "battery", addonId: "battery" },
					}),
				],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 10,
				availablePvSurplusPowerW: 2000,
				remainingPvSurplusPowerW: 2000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const prefs: AiSlotPreference[] = [
			{ addonId: "battery", slotStartIso: T1, weight: 0.2 },
			{ addonId: "battery", slotStartIso: T2, weight: 3 },
		];
		const result = buildCompareResult(plan, ["battery"], prefs);
		assert.ok(Math.abs(result.delta.planA.batKwh - result.delta.planB.batKwh) < 1e-6);
		assert.ok(result.chartB[1].batW > result.chartA[1].batW);
		assert.ok(result.chartB[0].batW < result.chartA[0].batW);
		assert.equal(result.delta.activePlan, "b");
		assert.deepEqual(result.delta.aiInvolvedAddonIds, ["battery"]);
		// IH/AC remain zero when only battery is allowed.
		assert.equal(result.chartA[0].ihW, 0);
		assert.equal(result.chartB[0].ihW, 0);
		assert.equal(result.chartA[0].acW, 0);
		assert.equal(result.chartB[0].acW, 0);
	});

	it("IH-only preference is unchanged when battery is also eligible but has no prefs (no regression)", () => {
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 400,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({ contributionId: "immersion_heater.flexible", slotStart: T1, allocatedPowerW: 400, gridPowerW: 400 }),
				],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 10,
				availablePvSurplusPowerW: 1000,
				remainingPvSurplusPowerW: 1000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const prefs: AiSlotPreference[] = [
			{ addonId: "immersion_heater", slotStartIso: T1, weight: 0.2 },
			{ addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
		];
		const onlyIh = buildCompareResult(plan, ["immersion_heater"], prefs);
		const ihPlusBatEligible = buildCompareResult(plan, ["immersion_heater", "battery"], prefs);
		assert.equal(onlyIh.delta.activePlan, "b");
		assert.equal(ihPlusBatEligible.delta.activePlan, "b");
		assert.equal(onlyIh.chartB[0].ihW, ihPlusBatEligible.chartB[0].ihW);
		assert.equal(onlyIh.chartB[1].ihW, ihPlusBatEligible.chartB[1].ihW);
		assert.equal(ihPlusBatEligible.chartB[0].batW, 0);
		assert.equal(ihPlusBatEligible.chartB[1].batW, 0);
	});

	it("shifts wallbox.ev_session toward cheap slot when wallbox AI allowed; respects deadline", () => {
		const deadline = "2026-07-25T10:20:00.000Z"; // before T2 end but after T1 — T2 starts at 10:15, still before deadline
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 3000,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({
						contributionId: "wallbox.ev_session",
						slotStart: T1,
						allocatedPowerW: 3000,
						gridPowerW: 3000,
						deadlineIso: deadline,
						contributor: { type: "addon", id: "wallbox", addonId: "wallbox" },
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
		const prefs: AiSlotPreference[] = [
			{ addonId: "wallbox", slotStartIso: T1, weight: 0.2 },
			{ addonId: "wallbox", slotStartIso: T2, weight: 3 },
		];
		const result = buildCompareResult(plan, ["wallbox"], prefs);
		assert.ok(Math.abs(result.delta.planA.wbKwh - result.delta.planB.wbKwh) < 1e-6);
		assert.ok(result.chartB[1].wbW > result.chartA[1].wbW);
		assert.equal(result.delta.activePlan, "b");
		assert.deepEqual(result.delta.aiInvolvedAddonIds, ["wallbox"]);
	});

	it("does not move wallbox energy into slots at/after deadline", () => {
		const deadline = T2; // T2 start == deadline → capacity locked to ownW (0)
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 2000,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({
						contributionId: "wallbox.ev_session",
						slotStart: T1,
						allocatedPowerW: 2000,
						gridPowerW: 2000,
						deadlineIso: deadline,
						contributor: { type: "addon", id: "wallbox", addonId: "wallbox" },
					}),
				],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 5,
				availablePvSurplusPowerW: 5000,
				remainingPvSurplusPowerW: 5000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const prefs: AiSlotPreference[] = [
			{ addonId: "wallbox", slotStartIso: T1, weight: 0.1 },
			{ addonId: "wallbox", slotStartIso: T2, weight: 3 },
		];
		const result = buildCompareResult(plan, ["wallbox"], prefs);
		assert.equal(result.chartB[1].wbW, 0);
		assert.ok(Math.abs(result.delta.planA.wbKwh - result.delta.planB.wbKwh) < 1e-6);
	});

	it("wallboxPvOnly: Plan B cannot invent large grid peaks beyond PV room", () => {
		const plan = minimalPlan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 3000,
				remainingGridImportPowerWAfterAlloc: 8000,
				remainingPvSurplusPowerW: 0,
				availablePvSurplusPowerW: 0,
				allocations: [
					allocation({
						contributionId: "wallbox.ev_session",
						slotStart: T1,
						allocatedPowerW: 3000,
						gridPowerW: 3000,
						contributor: { type: "addon", id: "wallbox", addonId: "wallbox" },
					}),
				],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 10,
				availablePvSurplusPowerW: 500,
				remainingPvSurplusPowerW: 500,
				remainingGridImportPowerWAfterAlloc: 8000,
			}),
		]);
		const prefs: AiSlotPreference[] = [
			{ addonId: "wallbox", slotStartIso: T1, weight: 0.1 },
			{ addonId: "wallbox", slotStartIso: T2, weight: 3 },
		];
		const withGrid = buildCompareResult(plan, ["wallbox"], prefs);
		const pvOnly = buildCompareResult(plan, ["wallbox"], prefs, { wallboxPvOnly: true });
		// Without PV-only, T2 can pull grid room; with PV-only capacity is ownW(0)+500.
		assert.ok(withGrid.chartB[1]!.wbW >= pvOnly.chartB[1]!.wbW);
		assert.ok(pvOnly.chartB[1]!.wbW <= 500 + 1e-6);
	});

	it("defer_tomorrow: excludes today, moves flex IH to tomorrow, accepts B at economic tie", () => {
		const today = "2026-09-02T10:00:00.000Z";
		const tomorrow = "2026-09-03T10:00:00.000Z";
		const plan = minimalPlan([
			slot({
				startIso: today,
				gridPriceCtPerKwh: 12,
				availablePvSurplusPowerW: 2000,
				remainingPvSurplusPowerW: 0,
				allocatedPvPowerW: 1700,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({
						contributionId: "immersion_heater.flexible",
						slotStart: today,
						allocatedPowerW: 1700,
						pvPowerW: 1700,
						gridPowerW: 0,
						energySource: "pv_surplus",
					}),
				],
			}),
			slot({
				startIso: tomorrow,
				gridPriceCtPerKwh: 12,
				availablePvSurplusPowerW: 2000,
				remainingPvSurplusPowerW: 2000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const slotPreferences: AiSlotPreference[] = [
			{ addonId: "immersion_heater", slotStartIso: today, weight: 0 },
			{ addonId: "immersion_heater", slotStartIso: tomorrow, weight: 3 },
		];
		const withoutFlag = buildCompareResult(plan, ["immersion_heater"], slotPreferences);
		const withFlag = buildCompareResult(plan, ["immersion_heater"], slotPreferences, {
			immersionDeferTomorrow: true,
		});
		assert.ok(withFlag.chartB[0]!.ihW < withFlag.chartA[0]!.ihW);
		assert.ok(withFlag.chartB[1]!.ihW > withFlag.chartA[1]!.ihW);
		assert.equal(withFlag.chartB[0]!.ihW, 0);
		assert.equal(Math.abs(withFlag.delta.deltaCostCt) < 0.05, true);
		assert.equal(withFlag.delta.activePlan, "b");
		assert.match(withFlag.delta.decisionReasonDe, /defer_tomorrow/);
		assert.equal(withoutFlag.delta.activePlan, "a");
	});

	it("defer_tomorrow: leftover stays unallocated, not put back on today, mandatory untouched", () => {
		const today = "2026-09-02T10:00:00.000Z";
		const tomorrow = "2026-09-03T10:00:00.000Z";
		const plan = minimalPlan([
			slot({
				startIso: today,
				gridPriceCtPerKwh: 12,
				availablePvSurplusPowerW: 2000,
				remainingPvSurplusPowerW: 0,
				allocatedPvPowerW: 1700,
				allocatedGridPowerW: 200,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({
						contributionId: "immersion_heater.flexible",
						slotStart: today,
						allocatedPowerW: 1700,
						pvPowerW: 1700,
						gridPowerW: 0,
						energySource: "pv_surplus",
					}),
					allocation({
						contributionId: "immersion_heater.mandatory",
						slotStart: today,
						allocatedPowerW: 200,
						gridPowerW: 200,
						mandatory: true,
					}),
				],
			}),
			slot({
				startIso: tomorrow,
				gridPriceCtPerKwh: 12,
				availablePvSurplusPowerW: 0,
				remainingPvSurplusPowerW: 0,
				remainingGridImportPowerWAfterAlloc: 0,
				gridImportAllowed: false,
			}),
		]);
		plan.totals.flexibleUnallocatedEnergyKwh = 0;
		const slotPreferences: AiSlotPreference[] = [
			{ addonId: "immersion_heater", slotStartIso: today, weight: 0 },
			{ addonId: "immersion_heater", slotStartIso: tomorrow, weight: 3 },
		];
		const result = buildCompareResult(plan, ["immersion_heater"], slotPreferences, {
			immersionDeferTomorrow: true,
		});
		assert.equal(result.chartB[0]!.ihW, 0);
		assert.equal(result.chartB[1]!.ihW, 0);
		assert.ok((result.delta.planB.unallocatedKwh ?? 0) > (result.delta.planA.unallocatedKwh ?? 0));
		assert.ok(result.delta.planB.ihKwh < result.delta.planA.ihKwh);
		assert.equal(result.delta.activePlan, "b");
		assert.match(result.delta.decisionReasonDe, /defer_tomorrow/);
	});
});
