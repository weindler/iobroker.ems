"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const openai_provider_js_1 = require("./openai_provider.js");
function baseRequest() {
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
            thermalRuntimeStatus: null,
            thermalEstimatedEmptyAt: null,
            batteryRuntimeStatus: null,
            batteryTopOffIntervalDays: null,
            priceLearningStatus: null,
            priceAvgEurPerKwh7d: null,
            houseLoadStatus: null,
        },
        policyHighlights: {},
        triggerReason: "test",
    };
}
function fakeFetch(response, status = 200) {
    return (async () => ({
        ok: status >= 200 && status < 300,
        status,
        json: async () => response,
        text: async () => JSON.stringify(response),
    }));
}
(0, node_test_1.describe)("openai provider", () => {
    (0, node_test_1.it)("returns no_token error when apiKey is empty (never calls fetch)", async () => {
        let called = false;
        const provider = (0, openai_provider_js_1.createOpenAiProvider)((async () => {
            called = true;
            throw new Error("must not be called");
        }));
        const res = await provider.optimize(baseRequest(), { apiKey: "", model: "gpt-4.1-mini", timeoutMs: 1000 });
        strict_1.default.equal(res.ok, false);
        strict_1.default.equal(res.error, "no_token");
        strict_1.default.equal(called, false);
    });
    (0, node_test_1.it)("parses a valid structured response and filters proposals to allowed addons only", async () => {
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
        const provider = (0, openai_provider_js_1.createOpenAiProvider)(fetchImpl);
        const res = await provider.optimize(baseRequest(), {
            apiKey: "sk-test",
            model: "gpt-4.1-mini",
            timeoutMs: 1000,
        });
        strict_1.default.equal(res.ok, true);
        strict_1.default.equal(res.proposals.length, 1);
        strict_1.default.equal(res.proposals[0].addonId, "immersion_heater");
        strict_1.default.equal(res.reasonDe, "Testbegründung.");
        strict_1.default.equal(res.usage.promptTokens, 120);
        strict_1.default.equal(res.usage.completionTokens, 40);
    });
    (0, node_test_1.it)("parses slot_preferences: keeps allowed-addon entries with a valid slot iso, clamps weight, drops the rest", async () => {
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
        const provider = (0, openai_provider_js_1.createOpenAiProvider)(fetchImpl);
        const res = await provider.optimize(baseRequest(), {
            apiKey: "sk-test",
            model: "gpt-4.1-mini",
            timeoutMs: 1000,
        });
        strict_1.default.equal(res.ok, true);
        strict_1.default.equal(res.slotPreferences.length, 3);
        strict_1.default.equal(res.slotPreferences[0].weight, 2.5);
        strict_1.default.equal(res.slotPreferences[1].weight, 3);
        strict_1.default.equal(res.slotPreferences[2].weight, 0);
        strict_1.default.ok(res.slotPreferences.every((p) => p.addonId === "immersion_heater"));
    });
    (0, node_test_1.it)("http error status → ok=false with http_<status> error, no throw", async () => {
        const provider = (0, openai_provider_js_1.createOpenAiProvider)(fakeFetch({ error: "bad key" }, 401));
        const res = await provider.optimize(baseRequest(), {
            apiKey: "sk-bad",
            model: "gpt-4.1-mini",
            timeoutMs: 1000,
        });
        strict_1.default.equal(res.ok, false);
        strict_1.default.ok(res.error?.startsWith("http_401"));
    });
    (0, node_test_1.it)("invalid JSON content → ok=false, invalid_json", async () => {
        const fetchImpl = fakeFetch({
            choices: [{ message: { content: "not json" } }],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
        });
        const provider = (0, openai_provider_js_1.createOpenAiProvider)(fetchImpl);
        const res = await provider.optimize(baseRequest(), {
            apiKey: "sk-test",
            model: "gpt-4.1-mini",
            timeoutMs: 1000,
        });
        strict_1.default.equal(res.ok, false);
        strict_1.default.equal(res.error, "invalid_json");
        strict_1.default.equal(res.usage.promptTokens, 10);
    });
    (0, node_test_1.it)("empty proposals with no reason_de → falls back to a generic German reason", async () => {
        const fetchImpl = fakeFetch({
            choices: [{ message: { content: JSON.stringify({ proposals: [] }) } }],
            usage: { prompt_tokens: 5, completion_tokens: 5 },
        });
        const provider = (0, openai_provider_js_1.createOpenAiProvider)(fetchImpl);
        const res = await provider.optimize(baseRequest(), {
            apiKey: "sk-test",
            model: "gpt-4.1-mini",
            timeoutMs: 1000,
        });
        strict_1.default.equal(res.ok, true);
        strict_1.default.equal(res.proposals.length, 0);
        strict_1.default.equal(res.reasonDe, "Kein Optimierungsbedarf gemeldet.");
    });
    (0, node_test_1.it)("network error rejects gracefully with ok=false", async () => {
        const provider = (0, openai_provider_js_1.createOpenAiProvider)((async () => {
            throw new Error("ECONNRESET");
        }));
        const res = await provider.optimize(baseRequest(), {
            apiKey: "sk-test",
            model: "gpt-4.1-mini",
            timeoutMs: 1000,
        });
        strict_1.default.equal(res.ok, false);
        strict_1.default.ok(res.error?.includes("ECONNRESET"));
    });
});
