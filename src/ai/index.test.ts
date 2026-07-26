import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	handleAiStateChange,
	isAiRelatedState,
	maybeTriggerAiOptimizationOnDailyPlanChange,
	resetAiPipelineHookForTest,
} from "./index.js";
import { AI_STATES } from "./ensure_states.js";
import { DAILY_PLAN_STATE_IDS } from "../operator/daily_plan/states.js";
import type { AiStateChangeHost } from "./index.js";
import type { AiRunHost } from "./run.js";
import type { DailyPlan } from "../operator/daily_plan/types.js";

describe("ai state change routing", () => {
	it("isAiRelatedState only matches the optimize-now button id", () => {
		assert.equal(isAiRelatedState(AI_STATES.optimizeNowRequest), true);
		assert.equal(isAiRelatedState("ai.status"), false);
		assert.equal(isAiRelatedState("backup.export_request"), false);
	});

	it("ignores ack=true / val!=true / unrelated ids (no run, no ack-flip)", async () => {
		const store = new Map<string, ioBroker.StateValue>();
		const host: AiStateChangeHost = {
			config: {},
			log: { debug() {}, warn() {}, error() {} },
			async getStateAsync(id: string) {
				const v = store.get(id);
				return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
			},
			async setStateAsync(id: string, state: ioBroker.SettableState) {
				store.set(id, state.val as ioBroker.StateValue);
			},
		};
		const handledAckTrue = await handleAiStateChange(host, AI_STATES.optimizeNowRequest, true, true);
		assert.equal(handledAckTrue, false);
		const handledFalseVal = await handleAiStateChange(host, AI_STATES.optimizeNowRequest, false, false);
		assert.equal(handledFalseVal, false);
		const handledOther = await handleAiStateChange(host, "ai.status", true, false);
		assert.equal(handledOther, false);
	});

	it("val=true/ack=false → resets button and attempts a run (fail-closed: no plan → no throw)", async () => {
		const store = new Map<string, ioBroker.StateValue>();
		const host: AiStateChangeHost = {
			config: {},
			log: { debug() {}, warn() {}, error() {} },
			async getStateAsync(id: string) {
				const v = store.get(id);
				return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
			},
			async setStateAsync(id: string, state: ioBroker.SettableState) {
				store.set(id, state.val as ioBroker.StateValue);
			},
		};
		const handled = await handleAiStateChange(host, AI_STATES.optimizeNowRequest, true, false);
		assert.equal(handled, true);
		assert.equal(store.get(AI_STATES.optimizeNowRequest), false);
		// no daily plan present in the mock host → runAiOptimizationManual resolves without throwing
		assert.equal(store.get(DAILY_PLAN_STATE_IDS.planJson), undefined);
	});
});

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
		...overrides,
	};
}

function mockRunHost(config: Record<string, unknown>): AiRunHost & { store: Map<string, ioBroker.StateValue> } {
	const store = new Map<string, ioBroker.StateValue>();
	return {
		config,
		store,
		log: { debug() {}, warn() {}, error() {} },
		async getStateAsync(id: string) {
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
}

describe("maybeTriggerAiOptimizationOnDailyPlanChange — digest-based throttling", () => {
	it("does not trigger again when only revision/slots change but the coarse digest stays equal", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
		const first = await maybeTriggerAiOptimizationOnDailyPlanChange(host, minimalPlan({ revision: 1 }));
		assert.ok(first !== null);
		assert.equal(first?.status, "no_token");

		const second = await maybeTriggerAiOptimizationOnDailyPlanChange(host, minimalPlan({ revision: 2, slots: [] }));
		assert.equal(second, null);
	});

	it("does not trigger again when only allocation progress changes but demand digest stays equal", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
		const baseTotals = {
			...minimalPlan().totals,
			flexibleRequestedEnergyKwh: 5,
		};
		const first = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...baseTotals, flexibleAllocatedEnergyKwh: 0.5, flexibleUnallocatedEnergyKwh: 4.5 } }),
		);
		assert.ok(first !== null);

		const second = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({
				revision: 99,
				totals: { ...baseTotals, flexibleAllocatedEnergyKwh: 2.4, flexibleUnallocatedEnergyKwh: 2.6 },
			}),
		);
		assert.equal(second, null);
	});

	it("triggers again once the coarse digest changes (e.g. flexible demand jumps by more than one bucket)", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
		const first = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }),
		);
		assert.ok(first !== null);

		const second = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
		);
		assert.ok(second !== null);
	});

	it("while disabled, tracks the digest so re-enabling with the same unchanged plan doesn't immediately fire", async () => {
		resetAiPipelineHookForTest();
		const disabledHost = mockRunHost({ ai_enabled: false });
		const plan = minimalPlan({ revision: 1 });
		const whileDisabled = await maybeTriggerAiOptimizationOnDailyPlanChange(disabledHost, plan);
		assert.equal(whileDisabled, null);

		const enabledHost = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
		const afterEnableUnchanged = await maybeTriggerAiOptimizationOnDailyPlanChange(enabledHost, plan);
		assert.equal(afterEnableUnchanged, null);

		const afterEnableChanged = await maybeTriggerAiOptimizationOnDailyPlanChange(
			enabledHost,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
		);
		assert.ok(afterEnableChanged !== null);
	});
});
