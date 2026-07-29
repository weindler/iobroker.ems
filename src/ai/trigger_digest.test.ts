import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aiTriggerDigestPayload } from "./trigger_digest.js";
import type { DailyPlan } from "../operator/daily_plan/types.js";

function minimalPlan(overrides: Partial<DailyPlan> = {}): DailyPlan {
	return {
		generatedAt: "2026-07-25T10:00:00.000Z",
		validUntil: null,
		revision: 1,
		date: "2026-07-25",
		timezone: "Europe/Berlin",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: ["pv", "house_load"],
		excludedContributions: [],
		slots: [],
		allocations: [],
		unallocated: [],
		totals: {
			pvForecastEnergyKwh: 30,
			fixedHouseLoadEnergyKwh: 10,
			fixedRenewableBalanceKwh: 20,
			flexibleRequestedEnergyKwh: 5,
			flexibleAllocatedEnergyKwh: 2,
			flexibleUnallocatedEnergyKwh: 3,
			pvAllocatedEnergyKwh: 2,
			gridAllocatedEnergyKwh: 0,
			batteryChargeEnergyKwh: 0,
			wallboxEnergyKwh: 0,
			immersionHeaterEnergyKwh: 2,
			airConditioningEnergyKwh: 0,
			estimatedGridCostCt: 400,
			mandatoryRequestedEnergyKwh: null,
			mandatoryAllocatedEnergyKwh: 0,
			mandatoryUnallocatedEnergyKwh: null,
		},
		quality: { status: "valid", confidencePct: 100, reasonDe: "" },
		reasonDe: "Testplan",
		...overrides,
	};
}

describe("aiTriggerDigestPayload", () => {
	it("is stable when only the revision/slots change (horizon roll, allocation ticks)", () => {
		const a = minimalPlan({ revision: 1, slots: [] });
		const b = minimalPlan({ revision: 42, slots: [] });
		assert.equal(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("is stable for sub-bucket energy noise (< bucket size)", () => {
		const a = minimalPlan({
			totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5.02, pvForecastEnergyKwh: 30.4 },
		});
		const b = minimalPlan({
			totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5.2, pvForecastEnergyKwh: 30.9 },
		});
		assert.equal(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("is stable when only allocation progress changes (assigned/unassigned totals move slot-by-slot)", () => {
		const a = minimalPlan({
			totals: {
				...minimalPlan().totals,
				flexibleRequestedEnergyKwh: 5,
				flexibleAllocatedEnergyKwh: 0.5,
				flexibleUnallocatedEnergyKwh: 4.5,
			},
		});
		const b = minimalPlan({
			totals: {
				...minimalPlan().totals,
				flexibleRequestedEnergyKwh: 5,
				flexibleAllocatedEnergyKwh: 2.4,
				flexibleUnallocatedEnergyKwh: 2.6,
			},
		});
		assert.equal(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("is stable when flex demand is repeated across multiple allocation slots (same contribution)", () => {
		const totalsBase = { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 0.494, flexibleAllocatedEnergyKwh: 0.2 };
		const a = minimalPlan({ totals: totalsBase });
		const b = minimalPlan({
			totals: { ...totalsBase, flexibleAllocatedEnergyKwh: 0.49 },
		});
		assert.equal(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("changes when flexibleRequestedEnergyKwh jumps by more than one bucket (e.g. target temp step)", () => {
		const a = minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } });
		const b = minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 6 } });
		assert.notEqual(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("changes when pvForecastEnergyKwh jumps clearly (weather revision)", () => {
		const a = minimalPlan({ totals: { ...minimalPlan().totals, pvForecastEnergyKwh: 30 } });
		const b = minimalPlan({ totals: { ...minimalPlan().totals, pvForecastEnergyKwh: 40 } });
		assert.notEqual(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("changes when an add-on starts or stops contributing", () => {
		const a = minimalPlan({ activeContributionIds: ["pv", "house_load"] });
		const b = minimalPlan({ activeContributionIds: ["pv", "house_load", "immersion_heater.flexible"] });
		assert.notEqual(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("changes when wallbox/battery flex family appears (vehicle plugged / charge need)", () => {
		const a = minimalPlan({ activeContributionIds: ["pv", "house_load"] });
		const b = minimalPlan({ activeContributionIds: ["pv", "house_load", "wallbox.ev_session"] });
		const c = minimalPlan({ activeContributionIds: ["pv", "house_load", "battery.charge"] });
		assert.notEqual(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
		assert.notEqual(aiTriggerDigestPayload(a), aiTriggerDigestPayload(c));
	});

	it("changes when median grid price jumps by more than the price bucket (material price change)", () => {
		const a = minimalPlan({
			slots: [
				{
					slot: { startIso: "2026-07-25T10:00:00.000Z", endIso: "2026-07-25T10:15:00.000Z" },
					pvForecastPowerW: null,
					fixedHouseLoadPowerW: null,
					fixedBalancePowerW: null,
					gridPriceCtPerKwh: 20,
					gridImportAllowed: true,
					configuredGridImportLimitW: null,
					remainingGridImportPowerW: null,
					availablePvSurplusPowerW: null,
					allocatedFlexiblePowerW: 0,
					allocatedPvPowerW: 0,
					allocatedGridPowerW: 0,
					allocatedBatteryPowerW: 0,
					remainingPvSurplusPowerW: null,
					remainingGridImportPowerWAfterAlloc: null,
					remainingBatteryDischargePowerW: null,
					allocations: [],
					quality: { status: "valid", confidencePct: 100, reasonDe: "" },
					reasonDe: "",
				},
			],
		});
		const b = minimalPlan({
			slots: [
				{
					...a.slots[0]!,
					gridPriceCtPerKwh: 28,
				},
			],
		});
		assert.notEqual(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("is stable for small median price noise within the price bucket", () => {
		const baseSlot = {
			slot: { startIso: "2026-07-25T10:00:00.000Z", endIso: "2026-07-25T10:15:00.000Z" },
			pvForecastPowerW: null as number | null,
			fixedHouseLoadPowerW: null as number | null,
			fixedBalancePowerW: null as number | null,
			gridImportAllowed: true,
			configuredGridImportLimitW: null as number | null,
			remainingGridImportPowerW: null as number | null,
			availablePvSurplusPowerW: null as number | null,
			allocatedFlexiblePowerW: 0,
			allocatedPvPowerW: 0,
			allocatedGridPowerW: 0,
			allocatedBatteryPowerW: 0,
			remainingPvSurplusPowerW: null as number | null,
			remainingGridImportPowerWAfterAlloc: null as number | null,
			remainingBatteryDischargePowerW: null as number | null,
			allocations: [] as [],
			quality: { status: "valid" as const, confidencePct: 100, reasonDe: "" },
			reasonDe: "",
		};
		const a = minimalPlan({ slots: [{ ...baseSlot, gridPriceCtPerKwh: 20 }] });
		const b = minimalPlan({ slots: [{ ...baseSlot, gridPriceCtPerKwh: 22 }] });
		assert.equal(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("changes on date or global mode change", () => {
		const a = minimalPlan({ date: "2026-07-25" });
		const b = minimalPlan({ date: "2026-07-26" });
		assert.notEqual(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));

		const c = minimalPlan({ globalMode: "balanced" });
		const d = minimalPlan({ globalMode: "eco" });
		assert.notEqual(aiTriggerDigestPayload(c), aiTriggerDigestPayload(d));
	});

	it("is order-independent for activeContributionIds/excludedContributions", () => {
		const a = minimalPlan({ activeContributionIds: ["b", "a"] });
		const b = minimalPlan({ activeContributionIds: ["a", "b"] });
		assert.equal(aiTriggerDigestPayload(a), aiTriggerDigestPayload(b));
	});

	it("handles null totals without throwing", () => {
		const plan = minimalPlan({
			totals: {
				...minimalPlan().totals,
				flexibleRequestedEnergyKwh: null,
				flexibleUnallocatedEnergyKwh: null,
				pvForecastEnergyKwh: null,
				estimatedGridCostCt: null,
			},
		});
		assert.doesNotThrow(() => aiTriggerDigestPayload(plan));
	});
});
