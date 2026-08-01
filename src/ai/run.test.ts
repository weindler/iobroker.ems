import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runAiOptimizationNow, type AiRunHost } from "./run.js";
import { AI_STATES } from "./ensure_states.js";
import type { AiProvider, AiOptimizationResult } from "./types.js";
import type { DailyPlan } from "../operator/daily_plan/types.js";

function minimalPlan(): DailyPlan {
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
	};
}

function mockHost(config: Record<string, unknown>): AiRunHost & { store: Map<string, ioBroker.StateValue> } {
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

function fakeProvider(result: AiOptimizationResult): AiProvider {
	return { id: "openai", async optimize() { return result; } };
}

const ALLOWED_CONFIG = {
	ai_enabled: true,
	ai_openai_api_key: "sk-test",
	ai_max_calls_per_day: 3,
	immersion_heater_enabled: true,
	immersion_heater_ai_optimization_allowed: true,
};

const emptyOk = {
	ok: true as const,
	proposals: [] as AiOptimizationResult["proposals"],
	slotPreferences: [] as AiOptimizationResult["slotPreferences"],
	thinkingDe: "",
	decisions: [] as AiOptimizationResult["decisions"],
	reasonDe: "x",
	usage: { promptTokens: 1 as number | null, completionTokens: 1 as number | null },
};

describe("runAiOptimizationNow — gating", () => {
	it("disabled globally → status off, provider never called", async () => {
		let called = false;
		const provider = fakeProvider({ ...emptyOk });
		provider.optimize = async () => {
			called = true;
			return { ...emptyOk };
		};
		const host = mockHost({ ai_enabled: false });
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "test", provider);
		assert.equal(outcome.status, "off");
		assert.equal(outcome.ran, false);
		assert.equal(called, false);
		assert.equal(host.store.get(AI_STATES.status), "off");
	});

	it("no token → status no_token, provider never called", async () => {
		let called = false;
		const provider: AiProvider = {
			id: "openai",
			async optimize() {
				called = true;
				return { ...emptyOk, reasonDe: "", usage: { promptTokens: null, completionTokens: null } };
			},
		};
		const host = mockHost({ ai_enabled: true, immersion_heater_enabled: true, immersion_heater_ai_optimization_allowed: true });
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "test", provider);
		assert.equal(outcome.status, "no_token");
		assert.equal(called, false);
	});

	it("no addon allowed → status no_addons_allowed, provider never called", async () => {
		let called = false;
		const provider: AiProvider = {
			id: "openai",
			async optimize() {
				called = true;
				return { ...emptyOk, reasonDe: "", usage: { promptTokens: null, completionTokens: null } };
			},
		};
		const host = mockHost({ ai_enabled: true, ai_openai_api_key: "sk-test" });
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "test", provider);
		assert.equal(outcome.status, "no_addons_allowed");
		assert.equal(called, false);
	});

	it("limit reached → status limit_reached, provider never called", async () => {
		let called = false;
		const provider: AiProvider = {
			id: "openai",
			async optimize() {
				called = true;
				return { ...emptyOk, reasonDe: "", usage: { promptTokens: null, completionTokens: null } };
			},
		};
		const host = mockHost({ ...ALLOWED_CONFIG, ai_max_calls_per_day: 1 });
		host.store.set(AI_STATES.callsToday, 1);
		host.store.set(AI_STATES.callsTodayDate, new Date().toISOString().slice(0, 10));
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "test", provider);
		assert.equal(outcome.status, "limit_reached");
		assert.equal(called, false);
	});
});

describe("runAiOptimizationNow — successful/failed calls", () => {
	it("successful call without slot prefs → status ready, increments daily counter, writes cost", async () => {
		const provider = fakeProvider({
			ok: true,
			proposals: [{ addonId: "immersion_heater", note: "x" }],
			slotPreferences: [],
			thinkingDe: "",
			decisions: [],
			reasonDe: "Alles gut.",
			usage: { promptTokens: 100, completionTokens: 50 },
		});
		const host = mockHost(ALLOWED_CONFIG);
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "new_daily_plan", provider);
		assert.equal(outcome.status, "ready");
		assert.equal(outcome.ran, true);
		assert.equal(host.store.get(AI_STATES.callsToday), 1);
		assert.equal(host.store.get(AI_STATES.lastRunResult), "ok");
		assert.ok(Number(host.store.get(AI_STATES.costEstimateTodayEur)) > 0);
		assert.equal(host.store.get(AI_STATES.lastSlotPreferencesJson), "[]");
	});

	it("thinking + decisions without derived prefs → ready, not suspended; thinking persisted", async () => {
		const provider = fakeProvider({
			ok: true,
			proposals: [],
			slotPreferences: [],
			thinkingDe: "Plan A ist schon sinnvoll — Puffer reicht.",
			decisions: [{ addonId: "immersion_heater", action: "keep_plan_a", note: "ok" }],
			reasonDe: "Kein Shift nötig.",
			usage: { promptTokens: 80, completionTokens: 40 },
		});
		const host = mockHost(ALLOWED_CONFIG);
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "new_daily_plan", provider);
		assert.equal(outcome.status, "ready");
		assert.equal(host.store.get(AI_STATES.autoSuspended), undefined);
		assert.equal(host.store.get(AI_STATES.lastThinkingDe), "Plan A ist schon sinnvoll — Puffer reicht.");
		assert.equal(host.store.get(AI_STATES.lastThinkingMode), true);
		assert.ok(String(host.store.get(AI_STATES.lastDecisionsJson)).includes("keep_plan_a"));
		assert.equal(host.store.get(AI_STATES.lastReasonDe), "Plan A ist schon sinnvoll — Puffer reicht.");
	});

	it("successful call with prefs that do not beat Plan A → suspended, prefs cleared", async () => {
		const provider = fakeProvider({
			ok: true,
			proposals: [{ addonId: "immersion_heater", note: "x" }],
			slotPreferences: [{ addonId: "immersion_heater", slotStartIso: "2026-07-25T10:00:00.000Z", weight: 2 }],
			thinkingDe: "",
			decisions: [],
			reasonDe: "Alles gut.",
			usage: { promptTokens: 100, completionTokens: 50 },
		});
		const host = mockHost(ALLOWED_CONFIG);
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "new_daily_plan", provider);
		assert.equal(outcome.status, "suspended");
		assert.equal(outcome.ran, true);
		assert.equal(host.store.get(AI_STATES.autoSuspended), true);
		assert.equal(host.store.get(AI_STATES.lastSlotPreferencesJson), "[]");
		assert.equal(host.store.get(AI_STATES.callsToday), 1);
	});

	it("failed call → status error, still counts against the daily limit, clears slot preferences", async () => {
		const provider = fakeProvider({
			ok: false,
			proposals: [],
			slotPreferences: [],
			thinkingDe: "",
			decisions: [],
			reasonDe: "Zeitüberschreitung.",
			usage: { promptTokens: null, completionTokens: null },
			error: "timeout",
		});
		const host = mockHost(ALLOWED_CONFIG);
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "manual", provider);
		assert.equal(outcome.status, "error");
		assert.equal(host.store.get(AI_STATES.callsToday), 1);
		assert.equal(host.store.get(AI_STATES.lastError), "timeout");
		assert.equal(host.store.get(AI_STATES.lastSlotPreferencesJson), "[]");
	});

	it("provider throwing synchronously is caught and treated as a failed attempt", async () => {
		const provider: AiProvider = { id: "openai", async optimize() { throw new Error("boom"); } };
		const host = mockHost(ALLOWED_CONFIG);
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "manual", provider);
		assert.equal(outcome.status, "error");
		assert.equal(host.store.get(AI_STATES.callsToday), 1);
	});
});
