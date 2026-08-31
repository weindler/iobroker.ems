import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createOpenAiAnalystProvider } from "./provider";
import type { AiAnalystContext } from "./context";

const CONTEXT: AiAnalystContext = {
	schemaVersion: 1,
	purpose: "daily_analyst_findings",
	dateKey: "2026-08-29",
	globalScore: 80,
	scores: [],
	eligibility: [],
	findings: [],
	economics: null,
	shadow: null,
	constraints: {
		aiIsAnalystOnly: true,
		aiMustNotControlDevices: true,
		aiMustNotInventEuroSavings: true,
		aiMustReturnStructuredFindingsOnly: true,
	},
};

function fakeFetch(response: { ok: boolean; status?: number; body: unknown }): typeof fetch {
	return (async () =>
		({
			ok: response.ok,
			status: response.status ?? (response.ok ? 200 : 500),
			json: async () => response.body,
			text: async () => JSON.stringify(response.body),
		}) as unknown as Response) as unknown as typeof fetch;
}

describe("createOpenAiAnalystProvider — Sicherheit bei KI-Ausfall", () => {
	it("liefert no_token ohne Netzwerkaufruf, wenn kein API-Key gesetzt ist", async () => {
		let called = false;
		const provider = createOpenAiAnalystProvider((async () => {
			called = true;
			throw new Error("should not be called");
		}) as unknown as typeof fetch);
		const r = await provider.analyze(CONTEXT, { apiKey: "", model: "gpt-4.1-mini", timeoutMs: 1000 });
		assert.equal(r.ok, false);
		assert.equal(r.error, "no_token");
		assert.equal(called, false);
	});

	it("behandelt HTTP-Fehler ohne zu werfen", async () => {
		const provider = createOpenAiAnalystProvider(fakeFetch({ ok: false, status: 429, body: { error: "rate limit" } }));
		const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /http_429/);
	});

	it("behandelt ungültiges JSON im content ohne zu werfen", async () => {
		const provider = createOpenAiAnalystProvider(
			fakeFetch({ ok: true, body: { choices: [{ message: { content: "not json" } }] } }),
		);
		const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
		assert.equal(r.ok, false);
		assert.equal(r.error, "invalid_json");
	});

	it("verwirft strukturell ungültige Antworten, statt sie teilweise zu übernehmen", async () => {
		const provider = createOpenAiAnalystProvider(
			fakeFetch({ ok: true, body: { choices: [{ message: { content: JSON.stringify({ notFindings: [] }) } }] } }),
		);
		const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
		assert.equal(r.ok, false);
		assert.match(r.error ?? "", /invalid_structure/);
	});

	it("liefert strukturierte Findings bei gültiger Antwort", async () => {
		const finding = {
			finding_type: "x",
			domain: "battery",
			severity: "info",
			confidence_pct: 60,
			evidence: ["a"],
			observed_behavior_de: "b",
			suggested_improvement_de: "c",
			affected_parameter: null,
			expected_direction: "unclear",
			uncertainty_de: "d",
		};
		const provider = createOpenAiAnalystProvider(
			fakeFetch({
				ok: true,
				body: {
					choices: [{ message: { content: JSON.stringify({ findings: [finding] }) } }],
					usage: { prompt_tokens: 100, completion_tokens: 50 },
				},
			}),
		);
		const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
		assert.equal(r.ok, true);
		assert.equal(r.findings.length, 1);
		assert.equal(r.usage.promptTokens, 100);
	});
});
