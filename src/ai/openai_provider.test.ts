import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiProvider } from "./openai_provider.js";
import type { AiOptimizationRequestContext } from "./types.js";

function emptySituation(): AiOptimizationRequestContext["situation"] {
	return {
		live: { pvPowerW: null, houseLoadW: null, surplusW: null, deficitW: null },
		wallbox: {
			connected: null,
			charging: null,
			mode: null,
			socPct: null,
			remainingEnergyKwh: null,
			effectiveLimitSoc: null,
			planActive: null,
			deadlineIso: null,
		},
		immersion: { bufferTempC: null, thermalEstimatedEmptyAt: null },
		climate: { units: [] },
		pvHorizon: [],
		pvTodayKwh: null,
		pvTomorrowKwh: null,
		priceNowCt: null,
		priceAvg7d: null,
		nextHours: {
			avgPvForecastPowerW: null,
			avgAvailablePvSurplusPowerW: null,
			minPriceCt: null,
			maxPriceCt: null,
		},
	};
}

function baseRequest(): AiOptimizationRequestContext {
	return {
		generatedAt: "2026-07-25T10:00:00.000Z",
		timezone: "Europe/Berlin",
		globalMode: "balanced",
		allowedAddonIds: ["immersion_heater"],
		dailyPlan: {
			date: "2026-07-25",
			globalMode: "balanced",
			status: "ready",
			timezone: "Europe/Berlin",
			slotMinutes: 15,
			horizonSlotCount: 2,
			validUntil: null,
			activeContributionIds: [],
			excludedContributionIds: [],
			totals: {
				pvForecastEnergyKwh: null,
				fixedHouseLoadEnergyKwh: null,
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
			},
			unallocated: [],
			slots: [
				{
					t: "2026-07-25T10:00:00.000Z",
					priceCtPerKwh: 30,
					pvSurplusW: 500,
					houseLoadW: null,
					ihFlexW: 200,
					acW: 0,
					batteryChargeW: 0,
					wallboxW: 0,
					allocatedPvW: 0,
					allocatedGridW: 0,
				},
				{
					t: "2026-07-25T10:15:00.000Z",
					priceCtPerKwh: 32,
					pvSurplusW: 400,
					houseLoadW: null,
					ihFlexW: 0,
					acW: 0,
					batteryChargeW: 0,
					wallboxW: 0,
					allocatedPvW: 0,
					allocatedGridW: 0,
				},
			],
		},
		learning: {
			pvBiasStatus: null,
			pvCorrectedTodayKwh: null,
			pvCorrectedTomorrowKwh: null,
			pvHorizonDays: [],
			thermalRuntimeStatus: null,
			thermalEstimatedEmptyAt: null,
			batteryRuntimeStatus: null,
			batteryTopOffIntervalDays: null,
			priceLearningStatus: null,
			priceAvgEurPerKwh7d: null,
			houseLoadStatus: null,
		},
		situation: emptySituation(),
		policyHighlights: {},
		triggerReason: "test",
	};
}

function fakeFetch(response: unknown, status = 200): typeof fetch {
	return (async () =>
		({
			ok: status >= 200 && status < 300,
			status,
			json: async () => response,
			text: async () => JSON.stringify(response),
		}) as unknown as Response) as unknown as typeof fetch;
}

describe("openai provider", () => {
	it("returns no_token error when apiKey is empty (never calls fetch)", async () => {
		let called = false;
		const provider = createOpenAiProvider((async () => {
			called = true;
			throw new Error("must not be called");
		}) as unknown as typeof fetch);
		const res = await provider.optimize(baseRequest(), { apiKey: "", model: "gpt-4.1-mini", timeoutMs: 1000 });
		assert.equal(res.ok, false);
		assert.equal(res.error, "no_token");
		assert.equal(called, false);
	});

	it("parses a valid structured response and filters proposals to allowed addons only", async () => {
		const fetchImpl = fakeFetch({
			choices: [
				{
					message: {
						content: JSON.stringify({
							proposals: [
								{ addon_id: "immersion_heater", note: "Etwas früher heizen." },
								{ addon_id: "wallbox", note: "Nicht erlaubt — muss verworfen werden." },
							],
							reason_de: "Testbegründung.",
						}),
					},
				},
			],
			usage: { prompt_tokens: 120, completion_tokens: 40 },
		});
		const provider = createOpenAiProvider(fetchImpl);
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-test",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
		});
		assert.equal(res.ok, true);
		assert.equal(res.proposals.length, 1);
		assert.equal(res.proposals[0].addonId, "immersion_heater");
		assert.equal(res.reasonDe, "Testbegründung.");
		assert.equal(res.usage.promptTokens, 120);
		assert.equal(res.usage.completionTokens, 40);
	});

	it("parses slot_preferences: keeps allowed-addon entries with a valid slot iso, clamps weight, drops the rest", async () => {
		const fetchImpl = fakeFetch({
			choices: [
				{
					message: {
						content: JSON.stringify({
							proposals: [],
							slot_preferences: [
								{ addon_id: "immersion_heater", slot_start_iso: "2026-07-25T10:00:00.000Z", weight: 2.5 },
								{ addon_id: "immersion_heater", slot_start_iso: "2026-07-25T10:00:00.000Z", weight: 99 },
								{ addon_id: "wallbox", slot_start_iso: "2026-07-25T10:00:00.000Z", weight: 2 },
								{ addon_id: "immersion_heater", slot_start_iso: "2099-01-01T00:00:00.000Z", weight: 2 },
								{ addon_id: "immersion_heater", slot_start_iso: "2026-07-25T10:15:00.000Z", weight: -5 },
							],
							reason_de: "Testbegründung.",
						}),
					},
				},
			],
			usage: { prompt_tokens: 120, completion_tokens: 40 },
		});
		const provider = createOpenAiProvider(fetchImpl);
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-test",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
		});
		assert.equal(res.ok, true);
		assert.equal(res.slotPreferences.length, 3);
		assert.equal(res.slotPreferences[0].weight, 2.5);
		assert.equal(res.slotPreferences[1].weight, 3);
		assert.equal(res.slotPreferences[2].weight, 0);
		assert.ok(res.slotPreferences.every((p) => p.addonId === "immersion_heater"));
	});

	it("http error status → ok=false with http_<status> error, no throw", async () => {
		const provider = createOpenAiProvider(fakeFetch({ error: "bad key" }, 401));
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-bad",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
		});
		assert.equal(res.ok, false);
		assert.ok(res.error?.startsWith("http_401"));
	});

	it("invalid JSON content → ok=false, invalid_json", async () => {
		const fetchImpl = fakeFetch({
			choices: [{ message: { content: "not json" } }],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});
		const provider = createOpenAiProvider(fetchImpl);
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-test",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
		});
		assert.equal(res.ok, false);
		assert.equal(res.error, "invalid_json");
		assert.equal(res.usage.promptTokens, 10);
	});

	it("empty proposals with no reason_de → falls back to a generic German reason", async () => {
		const fetchImpl = fakeFetch({
			choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }],
			usage: { prompt_tokens: 5, completion_tokens: 5 },
		});
		const provider = createOpenAiProvider(fetchImpl);
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-test",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
		});
		assert.equal(res.ok, true);
		assert.equal(res.proposals.length, 0);
		assert.equal(res.reasonDe, "Kein Optimierungsbedarf gemeldet.");
		assert.equal(res.thinkingDe, "");
		assert.deepEqual(res.decisions, []);
	});

	it("parses thinking_de + decisions; ignores unknown actions", async () => {
		const fetchImpl = fakeFetch({
			choices: [
				{
					message: {
						content: JSON.stringify({
							thinking_de: "Puffer reicht bis morgen, PV morgen stark.",
							decisions: [
								{ addon_id: "immersion_heater", action: "defer_tomorrow", note: "Morgen heizen." },
								{ addon_id: "immersion_heater", action: "charge_now", note: "ungültig für IH" },
								{ addon_id: "wallbox", action: "prefer_pv_today", note: "nicht erlaubt" },
							],
							proposals: [],
							slot_preferences: [],
							reason_de: "Kurzfassung.",
						}),
					},
				},
			],
			usage: { prompt_tokens: 50, completion_tokens: 30 },
		});
		const provider = createOpenAiProvider(fetchImpl);
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-test",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
			thinkingMode: true,
		});
		assert.equal(res.ok, true);
		assert.equal(res.thinkingDe, "Puffer reicht bis morgen, PV morgen stark.");
		assert.equal(res.decisions.length, 1);
		assert.equal(res.decisions[0]!.action, "defer_tomorrow");
		assert.equal(res.reasonDe, "Kurzfassung.");
	});

	it("legacy thinkingMode=false ignores decisions even if present", async () => {
		const fetchImpl = fakeFetch({
			choices: [
				{
					message: {
						content: JSON.stringify({
							thinking_de: "sollte ignoriert werden",
							decisions: [
								{ addon_id: "immersion_heater", action: "heat_today", note: "heute" },
							],
							proposals: [],
							reason_de: "Legacy.",
						}),
					},
				},
			],
			usage: { prompt_tokens: 10, completion_tokens: 5 },
		});
		const provider = createOpenAiProvider(fetchImpl);
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-test",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
			thinkingMode: false,
		});
		assert.equal(res.ok, true);
		assert.equal(res.thinkingDe, "");
		assert.deepEqual(res.decisions, []);
	});

	it("network error rejects gracefully with ok=false", async () => {
		const provider = createOpenAiProvider((async () => {
			throw new Error("ECONNRESET");
		}) as unknown as typeof fetch);
		const res = await provider.optimize(baseRequest(), {
			apiKey: "sk-test",
			model: "gpt-4.1-mini",
			timeoutMs: 1000,
		});
		assert.equal(res.ok, false);
		assert.ok(res.error?.includes("ECONNRESET"));
	});
});
