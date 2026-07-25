import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runPlanCompare } from "./run.js";
import { COMPARE_STATES } from "./ensure_states.js";
import { AI_STATES } from "../ensure_states.js";
import type { DailyAllocationEntry, DailyPlan, DailyPlanSlot } from "../../operator/daily_plan/types.js";

function minimalSlot(startIso: string, allocations: DailyAllocationEntry[] = []): DailyPlanSlot {
	return {
		slot: { startIso, endIso: startIso },
		pvForecastPowerW: null,
		fixedHouseLoadPowerW: null,
		fixedBalancePowerW: null,
		gridPriceCtPerKwh: 30,
		gridImportAllowed: true,
		configuredGridImportLimitW: 30000,
		remainingGridImportPowerW: 20000,
		availablePvSurplusPowerW: 0,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: 0,
		allocatedGridPowerW: allocations.reduce((s, a) => s + (a.gridPowerW ?? 0), 0),
		allocatedBatteryPowerW: 0,
		remainingPvSurplusPowerW: 0,
		remainingGridImportPowerWAfterAlloc: 20000,
		remainingBatteryDischargePowerW: null,
		allocations,
		quality: { status: "valid", confidencePct: 100, reasonDe: "" },
		reasonDe: "",
	};
}

function minimalPlan(): DailyPlan {
	const slots = [minimalSlot("2026-07-25T10:00:00.000Z")];
	return {
		generatedAt: "2026-07-25T09:00:00.000Z",
		validUntil: null,
		revision: 3,
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
		allocations: [],
		unallocated: [],
		totals: {
			pvForecastEnergyKwh: null,
			fixedHouseLoadEnergyKwh: null,
			fixedRenewableBalanceKwh: null,
			flexibleRequestedEnergyKwh: null,
			flexibleAllocatedEnergyKwh: 0,
			flexibleUnallocatedEnergyKwh: null,
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

function mockHost(config: Record<string, unknown>, initialStates: Record<string, ioBroker.StateValue> = {}) {
	const store = new Map<string, ioBroker.StateValue>(Object.entries(initialStates));
	return {
		config,
		store,
		async getStateAsync(id: string) {
			const v = store.get(id);
			return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
}

describe("runPlanCompare", () => {
	it("writes all compare.* states, defaults to activePlan=a when nothing is AI-allowed", async () => {
		const host = mockHost({});
		const result = await runPlanCompare(host, minimalPlan());
		assert.equal(host.store.get(COMPARE_STATES.activePlan), "a");
		assert.equal(host.store.get(COMPARE_STATES.planRevision), 3);
		assert.equal(typeof host.store.get(COMPARE_STATES.planAChartJson), "string");
		assert.equal(typeof host.store.get(COMPARE_STATES.planBChartJson), "string");
		assert.equal(typeof host.store.get(COMPARE_STATES.deltaSummaryJson), "string");
		assert.equal(result.delta.activePlan, "a");
	});

	it("ignores malformed ai.last_slot_preferences_json instead of throwing", async () => {
		const host = mockHost(
			{ immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true },
			{ [AI_STATES.lastSlotPreferencesJson]: "not json" },
		);
		const result = await runPlanCompare(host, minimalPlan());
		assert.equal(result.delta.activePlan, "a");
	});

	it("reads valid ai.last_slot_preferences_json and feeds it into the comparison", async () => {
		const slotPrefs = [{ addonId: "immersion_heater", slotStartIso: "2026-07-25T10:00:00.000Z", weight: 2 }];
		const host = mockHost(
			{ immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true },
			{ [AI_STATES.lastSlotPreferencesJson]: JSON.stringify(slotPrefs) },
		);
		const result = await runPlanCompare(host, minimalPlan());
		assert.deepEqual(result.delta.aiInvolvedAddonIds, ["immersion_heater"]);
	});
});
