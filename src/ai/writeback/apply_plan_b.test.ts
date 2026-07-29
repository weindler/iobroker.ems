import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { applyAiPreferencesToDailyPlan } from "./apply_plan_b.js";
import { planBBeatsPlanA } from "../compare/build.js";
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
		gridPowerW: rest.gridPowerW ?? rest.allocatedPowerW ?? 0,
		pvPowerW: rest.pvPowerW ?? 0,
		mandatory: false,
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
		gridImportAllowed: true,
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

function plan(slots: DailyPlanSlot[]): DailyPlan {
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
		activeContributionIds: ["immersion_heater"],
		excludedContributions: [],
		slots,
		allocations: slots.flatMap((s) => s.allocations),
		unallocated: [],
		totals: {
			pvForecastEnergyKwh: null,
			fixedHouseLoadEnergyKwh: null,
			fixedRenewableBalanceKwh: null,
			flexibleRequestedEnergyKwh: 1,
			flexibleAllocatedEnergyKwh: 1,
			flexibleUnallocatedEnergyKwh: 0,
			pvAllocatedEnergyKwh: 0,
			gridAllocatedEnergyKwh: 1,
			batteryChargeEnergyKwh: 0,
			wallboxEnergyKwh: 0,
			immersionHeaterEnergyKwh: 1,
			airConditioningEnergyKwh: 0,
			estimatedGridCostCt: 40,
			mandatoryRequestedEnergyKwh: null,
			mandatoryAllocatedEnergyKwh: 0,
			mandatoryUnallocatedEnergyKwh: null,
		},
		quality: { status: "valid", confidencePct: 100, reasonDe: "" },
		reasonDe: "Plan A",
	};
}

describe("planBBeatsPlanA", () => {
	it("wins on lower cost", () => {
		assert.equal(planBBeatsPlanA({ deltaCostCt: -1, deltaGridKwh: 0, deltaPvKwh: 0 }), true);
	});
	it("loses on higher cost even with better PV", () => {
		assert.equal(planBBeatsPlanA({ deltaCostCt: 1, deltaGridKwh: -1, deltaPvKwh: 2 }), false);
	});
	it("wins on equal cost with lower grid", () => {
		assert.equal(planBBeatsPlanA({ deltaCostCt: 0, deltaGridKwh: -0.1, deltaPvKwh: 0 }), true);
	});
});

describe("applyAiPreferencesToDailyPlan", () => {
	it("applies write-back when shifting load to cheaper/PV slot", () => {
		const p = plan([
			slot({
				startIso: T1,
				gridPriceCtPerKwh: 40,
				allocatedGridPowerW: 2000,
				remainingGridImportPowerWAfterAlloc: 5000,
				allocations: [
					allocation({
						contributionId: "immersion_heater.flexible",
						slotStart: T1,
						allocatedPowerW: 2000,
						gridPowerW: 2000,
					}),
				],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 10,
				availablePvSurplusPowerW: 3000,
				remainingPvSurplusPowerW: 3000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const prefs: AiSlotPreference[] = [
			{ addonId: "immersion_heater", slotStartIso: T1, weight: 0.1 },
			{ addonId: "immersion_heater", slotStartIso: T2, weight: 3 },
		];
		const r = applyAiPreferencesToDailyPlan(p, ["immersion_heater"], prefs);
		assert.equal(r.writebackApplied, true);
		assert.equal(r.compare.delta.activePlan, "b");
		assert.match(r.plan.reasonDe, /KI Plan B/);
		const ih1 = r.plan.slots[0]!.allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
		const ih2 = r.plan.slots[1]!.allocations.find((a) => a.contributionId.startsWith("immersion_heater"));
		assert.ok((ih1?.allocatedPowerW ?? 0) < 2000);
		assert.ok((ih2?.allocatedPowerW ?? 0) > 0);
	});

	it("does not write-back when preferences empty", () => {
		const p = plan([slot({ startIso: T1, allocations: [] })]);
		const r = applyAiPreferencesToDailyPlan(p, ["immersion_heater"], []);
		assert.equal(r.writebackApplied, false);
		assert.equal(r.plan.reasonDe, "Plan A");
	});

	it("write-back shifts battery.charge only; discharge row stays put", () => {
		const p = plan([
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
						allocatedPowerW: 400,
						gridPowerW: 0,
						contributor: { type: "addon", id: "battery", addonId: "battery" },
					}),
				],
			}),
			slot({
				startIso: T2,
				gridPriceCtPerKwh: 10,
				availablePvSurplusPowerW: 3000,
				remainingPvSurplusPowerW: 3000,
				remainingGridImportPowerWAfterAlloc: 5000,
			}),
		]);
		const prefs: AiSlotPreference[] = [
			{ addonId: "battery", slotStartIso: T1, weight: 0.1 },
			{ addonId: "battery", slotStartIso: T2, weight: 3 },
		];
		const r = applyAiPreferencesToDailyPlan(p, ["battery"], prefs);
		assert.equal(r.writebackApplied, true);
		const charge1 = r.plan.slots[0]!.allocations.find((a) => a.contributionId === "battery.charge");
		const charge2 = r.plan.slots[1]!.allocations.find((a) => a.contributionId === "battery.charge");
		const discharge1 = r.plan.slots[0]!.allocations.find((a) => a.contributionId === "battery.discharge");
		assert.ok((charge1?.allocatedPowerW ?? 0) < 1000);
		assert.ok((charge2?.allocatedPowerW ?? 0) > 0);
		assert.equal(discharge1?.allocatedPowerW, 400);
	});

	it("write-back shifts wallbox.ev_session when allowed", () => {
		const p = plan([
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
						deadlineIso: "2026-07-25T12:00:00.000Z",
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
			{ addonId: "wallbox", slotStartIso: T1, weight: 0.1 },
			{ addonId: "wallbox", slotStartIso: T2, weight: 3 },
		];
		const r = applyAiPreferencesToDailyPlan(p, ["wallbox"], prefs);
		assert.equal(r.writebackApplied, true);
		const wb1 = r.plan.slots[0]!.allocations.find((a) => a.contributionId === "wallbox.ev_session");
		const wb2 = r.plan.slots[1]!.allocations.find((a) => a.contributionId === "wallbox.ev_session");
		assert.ok((wb1?.allocatedPowerW ?? 0) < 3000);
		assert.ok((wb2?.allocatedPowerW ?? 0) > 0);
	});
});
