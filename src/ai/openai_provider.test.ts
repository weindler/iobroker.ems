import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiProvider } from "./openai_provider.js";
import type { AiOptimizationRequestContext } from "./types.js";

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
			activeContributionIds: [],
			excludedContributionIds: [],
			totals: {
				pvForecastEnergyKwh: null,
				flexibleAllocatedEnergyKwh: 0,
				flexibleUnallocatedEnergyKwh: null,
				estimatedGridCostCt: null,
			},
			unallocated: [],
		},
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
