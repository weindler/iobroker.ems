import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	clearStaleAiOptimizeNowRequest,
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
	it("isAiRelatedState matches optimize-now, user_enabled and daily-analyst run_now", () => {
		assert.equal(isAiRelatedState(AI_STATES.optimizeNowRequest), true);
		assert.equal(isAiRelatedState(AI_STATES.userEnabled), true);
		assert.equal(isAiRelatedState("ai.daily_analyst.run_now_request"), true);
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

	it("clears a leftover optimize_now_request=true without running", async () => {
		const store = new Map<string, ioBroker.StateValue>();
		store.set(AI_STATES.optimizeNowRequest, true);
		const host = {
			async getStateAsync(id: string) {
				const v = store.get(id);
				return v === undefined ? null : ({ val: v, ack: false } as ioBroker.State);
			},
			async setStateAsync(id: string, state: ioBroker.SettableState) {
				store.set(id, state.val as ioBroker.StateValue);
			},
		};
		const cleared = await clearStaleAiOptimizeNowRequest(host);
		assert.equal(cleared, true);
		assert.equal(store.get(AI_STATES.optimizeNowRequest), false);
	});

	it("daily_analyst.run_now_request val=true mit ack=true oder ack=false wird behandelt", async () => {
		const store = new Map<string, ioBroker.StateValue>();
		const host: AiStateChangeHost & { getAbsolutePath: (c?: string) => string } = {
			config: { ai_analyst_mode: "disabled" },
			log: { debug() {}, warn() {}, error() {} },
			getAbsolutePath: () => "/tmp/ems-analyst-state-test",
			async getStateAsync(id: string) {
				const v = store.get(id);
				return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
			},
			async setStateAsync(id: string, state: ioBroker.SettableState) {
				store.set(id, state.val as ioBroker.StateValue);
			},
		};
		const handledAckFalse = await handleAiStateChange(host, "ai.daily_analyst.run_now_request", true, false);
		assert.equal(handledAckFalse, true);
		const handledAckTrue = await handleAiStateChange(host, "ai.daily_analyst.run_now_request", true, true);
		assert.equal(handledAckTrue, true);
		const handledReset = await handleAiStateChange(host, "ai.daily_analyst.run_now_request", false, true);
		assert.equal(handledReset, true);
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
	if (config.ai_enabled === true) {
		store.set(AI_STATES.userEnabled, true);
	}
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

// Mindestabstand explizit deaktiviert (0), damit diese Tests ausschließlich das Digest-Verhalten
// prüfen — der Mindestabstand selbst hat eine eigene describe-Gruppe weiter unten.
const NO_INTERVAL = { ai_min_interval_minutes: 0 };

describe("maybeTriggerAiOptimizationOnDailyPlanChange — digest-based throttling", () => {
	it("does not trigger again when only revision/slots change but the coarse digest stays equal", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({
			ai_enabled: true,
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			...NO_INTERVAL,
		});
		const first = await maybeTriggerAiOptimizationOnDailyPlanChange(host, minimalPlan({ revision: 1 }));
		assert.ok(first !== null);
		assert.equal(first?.status, "no_token");

		const second = await maybeTriggerAiOptimizationOnDailyPlanChange(host, minimalPlan({ revision: 2, slots: [] }));
		assert.equal(second, null);
	});

	it("does not trigger again when only allocation progress changes but demand digest stays equal", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({
			ai_enabled: true,
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			...NO_INTERVAL,
		});
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
		const host = mockRunHost({
			ai_enabled: true,
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			...NO_INTERVAL,
		});
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
		const host = mockRunHost({
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			...NO_INTERVAL,
		});
		host.store.set(AI_STATES.userEnabled, false);
		const plan = minimalPlan({ revision: 1 });
		const whileDisabled = await maybeTriggerAiOptimizationOnDailyPlanChange(host, plan);
		assert.equal(whileDisabled, null);

		host.store.set(AI_STATES.userEnabled, true);
		const afterEnableUnchanged = await maybeTriggerAiOptimizationOnDailyPlanChange(host, plan);
		assert.equal(afterEnableUnchanged, null);

		const afterEnableChanged = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
		);
		assert.ok(afterEnableChanged !== null);
	});

	it("user_enabled toggle via state change bumps epoch and sets status off", async () => {
		resetAiPipelineHookForTest();
		const store = new Map<string, ioBroker.StateValue>();
		store.set(AI_STATES.userEnabled, true);
		store.set(AI_STATES.status, "ready");
		const host: AiStateChangeHost = {
			config: {},
			log: { debug() {}, warn() {}, error() {}, info() {} },
			async getStateAsync(id: string) {
				const v = store.get(id);
				return v === undefined ? null : ({ val: v, ack: true } as ioBroker.State);
			},
			async setStateAsync(id: string, state: ioBroker.SettableState) {
				store.set(id, state.val as ioBroker.StateValue);
			},
		};
		const handled = await handleAiStateChange(host, AI_STATES.userEnabled, false, false);
		assert.equal(handled, true);
		assert.equal(store.get(AI_STATES.userEnabled), false);
		assert.equal(store.get(AI_STATES.status), "off");
	});
});

describe("maybeTriggerAiOptimizationOnDailyPlanChange — minimum interval throttling (v0.1.196)", () => {
	it("fires immediately on the very first automatic trigger even with the default 60min interval", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
		const t0 = new Date("2026-07-26T08:00:00.000Z");
		const first = await maybeTriggerAiOptimizationOnDailyPlanChange(host, minimalPlan({ revision: 1 }), t0);
		assert.ok(first !== null);
	});

	it("suppresses a second digest change within the interval, then fires once the interval has elapsed", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
		const t0 = new Date("2026-07-26T08:00:00.000Z");
		const first = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }),
			t0,
		);
		assert.ok(first !== null);

		// digest changed again, but only 10 minutes later — well within the 60min default interval.
		const t1 = new Date("2026-07-26T08:10:00.000Z");
		const blocked = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
			t1,
		);
		assert.equal(blocked, null);

		// still within the interval and digest unchanged from t1's plan → stays blocked.
		const t2 = new Date("2026-07-26T08:30:00.000Z");
		const stillBlocked = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
			t2,
		);
		assert.equal(stillBlocked, null);

		// interval elapsed (61 minutes after t0) → fires with the now-current plan.
		const t3 = new Date("2026-07-26T09:01:00.000Z");
		const fired = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
			t3,
		);
		assert.ok(fired !== null);
	});

	it("respects a custom configured interval (e.g. 30 minutes)", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({
			ai_enabled: true,
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			ai_min_interval_minutes: 30,
		});
		const t0 = new Date("2026-07-26T08:00:00.000Z");
		await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }),
			t0,
		);

		const t1 = new Date("2026-07-26T08:29:00.000Z");
		const blocked = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
			t1,
		);
		assert.equal(blocked, null);

		const t2 = new Date("2026-07-26T08:31:00.000Z");
		const fired = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
			t2,
		);
		assert.ok(fired !== null);
	});

	it("with interval disabled (0), behaves exactly like pure digest-based throttling", async () => {
		resetAiPipelineHookForTest();
		const host = mockRunHost({
			ai_enabled: true,
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
			...NO_INTERVAL,
		});
		const t0 = new Date("2026-07-26T08:00:00.000Z");
		const first = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 1 } }),
			t0,
		);
		assert.ok(first !== null);

		const t1 = new Date("2026-07-26T08:00:01.000Z");
		const fired = await maybeTriggerAiOptimizationOnDailyPlanChange(
			host,
			minimalPlan({ totals: { ...minimalPlan().totals, flexibleRequestedEnergyKwh: 5 } }),
			t1,
		);
		assert.ok(fired !== null);
	});
});
