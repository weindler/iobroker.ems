"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const provider_1 = require("./provider");
const CONTEXT = {
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
function fakeFetch(response) {
    return (async () => ({
        ok: response.ok,
        status: response.status ?? (response.ok ? 200 : 500),
        json: async () => response.body,
        text: async () => JSON.stringify(response.body),
    }));
}
(0, node_test_1.describe)("createOpenAiAnalystProvider — Sicherheit bei KI-Ausfall", () => {
    (0, node_test_1.it)("liefert no_token ohne Netzwerkaufruf, wenn kein API-Key gesetzt ist", async () => {
        let called = false;
        const provider = (0, provider_1.createOpenAiAnalystProvider)((async () => {
            called = true;
            throw new Error("should not be called");
        }));
        const r = await provider.analyze(CONTEXT, { apiKey: "", model: "gpt-4.1-mini", timeoutMs: 1000 });
        strict_1.default.equal(r.ok, false);
        strict_1.default.equal(r.error, "no_token");
        strict_1.default.equal(called, false);
    });
    (0, node_test_1.it)("behandelt HTTP-Fehler ohne zu werfen", async () => {
        const provider = (0, provider_1.createOpenAiAnalystProvider)(fakeFetch({ ok: false, status: 429, body: { error: "rate limit" } }));
        const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
        strict_1.default.equal(r.ok, false);
        strict_1.default.match(r.error ?? "", /http_429/);
    });
    (0, node_test_1.it)("behandelt ungültiges JSON im content ohne zu werfen", async () => {
        const provider = (0, provider_1.createOpenAiAnalystProvider)(fakeFetch({ ok: true, body: { choices: [{ message: { content: "not json" } }] } }));
        const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
        strict_1.default.equal(r.ok, false);
        strict_1.default.equal(r.error, "invalid_json");
    });
    (0, node_test_1.it)("verwirft strukturell ungültige Antworten, statt sie teilweise zu übernehmen", async () => {
        const provider = (0, provider_1.createOpenAiAnalystProvider)(fakeFetch({ ok: true, body: { choices: [{ message: { content: JSON.stringify({ notFindings: [] }) } }] } }));
        const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
        strict_1.default.equal(r.ok, false);
        strict_1.default.match(r.error ?? "", /invalid_structure/);
    });
    (0, node_test_1.it)("liefert strukturierte Findings bei gültiger Antwort", async () => {
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
        const provider = (0, provider_1.createOpenAiAnalystProvider)(fakeFetch({
            ok: true,
            body: {
                choices: [{ message: { content: JSON.stringify({ findings: [finding] }) } }],
                usage: { prompt_tokens: 100, completion_tokens: 50 },
            },
        }));
        const r = await provider.analyze(CONTEXT, { apiKey: "sk-test", model: "gpt-4.1-mini", timeoutMs: 1000 });
        strict_1.default.equal(r.ok, true);
        strict_1.default.equal(r.findings.length, 1);
        strict_1.default.equal(r.usage.promptTokens, 100);
    });
});
