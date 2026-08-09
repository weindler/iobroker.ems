import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { AI_STATES } from "./ensure_states.js";
import { AI_ALLOCATION_LIVE_MUTATION_ENABLED } from "./writeback/authority.js";
import { runAiOptimizationNow, type AiRunHost } from "./run.js";
import type { AiProvider, AiOptimizationResult } from "./types.js";
import type { DailyPlan } from "../operator/daily_plan/types.js";
import {
	applyAiUserEnabledToggle,
	bumpAiEnableEpoch,
	currentAiEnableEpoch,
	isAiPublishAllowed,
	migrateAiUserEnabledOnce,
	readAiUserEnabled,
	resetAiEnableEpochForTest,
} from "./user_enabled.js";

function mockHost(config: Record<string, unknown> = {}) {
	const store = new Map<string, ioBroker.StateValue>();
	const host: AiRunHost & { store: Map<string, ioBroker.StateValue> } = {
		config,
		store,
		log: { debug() {}, warn() {}, error() {}, info() {} },
		async getStateAsync(id: string) {
			const val = store.get(id);
			return val === undefined ? null : ({ val, ack: true } as ioBroker.State);
		},
		async setStateAsync(id: string, state: ioBroker.SettableState) {
			store.set(id, state.val as ioBroker.StateValue);
		},
	};
	return host;
}

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

const emptyOk: AiOptimizationResult = {
	ok: true,
	proposals: [],
	slotPreferences: [],
	thinkingDe: "",
	decisions: [],
	reasonDe: "ok",
	usage: { promptTokens: 1, completionTokens: 1 },
};

describe("ai.user_enabled migration + epoch (v0.1.258)", () => {
	beforeEach(() => {
		resetAiEnableEpochForTest();
	});

	it("A) migrates native.ai_enabled=true → user_enabled=true once", async () => {
		const host = mockHost({ ai_enabled: true });
		const r = await migrateAiUserEnabledOnce(host);
		assert.equal(r.ran, true);
		assert.equal(r.userEnabled, true);
		assert.equal(host.store.get(AI_STATES.userEnabled), true);
		assert.equal(host.store.get(AI_STATES.userEnabledMigratedV1), true);
	});

	it("B) migrates native.ai_enabled=false → user_enabled=false", async () => {
		const host = mockHost({ ai_enabled: false });
		const r = await migrateAiUserEnabledOnce(host);
		assert.equal(r.ran, true);
		assert.equal(r.userEnabled, false);
		assert.equal(host.store.get(AI_STATES.userEnabled), false);
		assert.equal(host.store.get(AI_STATES.status), "off");
	});

	it("C) migration runs only once — later native true does not re-enable", async () => {
		const host = mockHost({ ai_enabled: true });
		await migrateAiUserEnabledOnce(host);
		host.store.set(AI_STATES.userEnabled, false);
		host.config = { ai_enabled: true };
		const again = await migrateAiUserEnabledOnce(host);
		assert.equal(again.ran, false);
		assert.equal(again.userEnabled, false);
		assert.equal(host.store.get(AI_STATES.userEnabled), false);
	});

	it("I) fresh install default user_enabled false when native missing", async () => {
		const host = mockHost({});
		const r = await migrateAiUserEnabledOnce(host);
		assert.equal(r.userEnabled, false);
		assert.equal(host.store.get(AI_STATES.userEnabled), false);
	});

	it("E/F/G) OFF during request discards; OFF→ON does not revive old request", async () => {
		const host = mockHost({
			ai_openai_api_key: "sk-test",
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
		});
		host.store.set(AI_STATES.userEnabled, true);

		let release!: () => void;
		const gate = new Promise<void>((r) => {
			release = r;
		});
		const provider: AiProvider = {
			id: "openai",
			async optimize() {
				await gate;
				return emptyOk;
			},
		};

		const pending = runAiOptimizationNow(host, minimalPlan(), "test", provider);
		await applyAiUserEnabledToggle(host, false);
		assert.equal(host.store.get(AI_STATES.status), "off");
		await applyAiUserEnabledToggle(host, true);
		assert.equal(host.store.get(AI_STATES.userEnabled), true);
		release();
		const outcome = await pending;
		assert.equal(outcome.ran, false);
		assert.match(outcome.reasonDe, /verworfen/i);
		assert.notEqual(host.store.get(AI_STATES.lastRunResult), "ok");
		assert.equal(host.store.get(AI_STATES.lastRunAt), undefined);
	});

	it("publish guard requires matching epoch and user_enabled", async () => {
		const host = mockHost({});
		host.store.set(AI_STATES.userEnabled, true);
		const epoch = currentAiEnableEpoch();
		assert.equal(await isAiPublishAllowed(host, epoch), true);
		bumpAiEnableEpoch();
		assert.equal(await isAiPublishAllowed(host, epoch), false);
		host.store.set(AI_STATES.userEnabled, false);
		assert.equal(await isAiPublishAllowed(host, currentAiEnableEpoch()), false);
	});

	it("toggle OFF sets status off without touching authority flag", async () => {
		const host = mockHost({});
		host.store.set(AI_STATES.userEnabled, true);
		host.store.set(AI_STATES.status, "ready");
		await applyAiUserEnabledToggle(host, false);
		assert.equal(await readAiUserEnabled(host), false);
		assert.equal(host.store.get(AI_STATES.status), "off");
		assert.equal(AI_ALLOCATION_LIVE_MUTATION_ENABLED, false);
	});

	it("K) user_enabled true without API key → no_token, no provider call", async () => {
		let called = false;
		const host = mockHost({
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
		});
		host.store.set(AI_STATES.userEnabled, true);
		const provider: AiProvider = {
			id: "openai",
			async optimize() {
				called = true;
				return emptyOk;
			},
		};
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "test", provider);
		assert.equal(outcome.status, "no_token");
		assert.equal(called, false);
	});

	it("native.ai_enabled alone no longer enables runtime", async () => {
		let called = false;
		const host = mockHost({
			ai_enabled: true,
			ai_openai_api_key: "sk-test",
			immersion_heater_enabled: true,
			immersion_heater_ai_optimization_allowed: true,
		});
		// migrated_v1 true, user_enabled false — native must be ignored
		host.store.set(AI_STATES.userEnabledMigratedV1, true);
		host.store.set(AI_STATES.userEnabled, false);
		const provider: AiProvider = {
			id: "openai",
			async optimize() {
				called = true;
				return emptyOk;
			},
		};
		const outcome = await runAiOptimizationNow(host, minimalPlan(), "test", provider);
		assert.equal(outcome.status, "off");
		assert.equal(called, false);
	});
});
