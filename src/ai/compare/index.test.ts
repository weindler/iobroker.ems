import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { maybeUpdatePlanCompareOnDailyPlanChange, resetPlanCompareHookForTest } from "./index.js";
import type { DailyPlan } from "../../operator/daily_plan/types.js";

function planWithRevision(revision: number): DailyPlan {
	return {
		generatedAt: "2026-07-25T09:00:00.000Z",
		validUntil: null,
		revision,
		date: "2026-07-25",
		timezone: "Europe/Berlin",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: [],
		excludedContributions: [],
		slots: [],
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

function mockHost() {
	const store = new Map<string, ioBroker.StateValue>();
	return {
		config: {},
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

describe("maybeUpdatePlanCompareOnDailyPlanChange", () => {
	it("runs on the first revision it sees, then skips repeats of the same revision", async () => {
		resetPlanCompareHookForTest();
		const host = mockHost();
		const first = await maybeUpdatePlanCompareOnDailyPlanChange(host, planWithRevision(1));
		assert.ok(first);
		const repeat = await maybeUpdatePlanCompareOnDailyPlanChange(host, planWithRevision(1));
		assert.equal(repeat, null);
		const second = await maybeUpdatePlanCompareOnDailyPlanChange(host, planWithRevision(2));
		assert.ok(second);
	});
});
