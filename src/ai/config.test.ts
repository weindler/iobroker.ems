import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { AI_DEFAULT_MAX_CALLS_PER_DAY, AI_DEFAULT_MODEL, aiConfigFromAdapter } from "./config.js";

describe("ai config", () => {
	it("defaults to fully off, no token, default model/limit", () => {
		const cfg = aiConfigFromAdapter({});
		assert.equal(cfg.enabled, false);
		assert.equal(cfg.provider, "openai");
		assert.equal(cfg.model, AI_DEFAULT_MODEL);
		assert.equal(cfg.apiKey, "");
		assert.equal(cfg.maxCallsPerDay, AI_DEFAULT_MAX_CALLS_PER_DAY);
	});

	it("reads enabled/model/token/limit from config", () => {
		const cfg = aiConfigFromAdapter({
			ai_enabled: true,
			ai_model: "gpt-4o-mini",
			ai_openai_api_key: "  sk-test-123  ",
			ai_max_calls_per_day: 5,
		});
		assert.equal(cfg.enabled, true);
		assert.equal(cfg.model, "gpt-4o-mini");
		assert.equal(cfg.apiKey, "sk-test-123");
		assert.equal(cfg.maxCallsPerDay, 5);
	});

	it("rejects unknown model → falls back to default (no free text)", () => {
		const cfg = aiConfigFromAdapter({ ai_model: "not-a-real-model" });
		assert.equal(cfg.model, AI_DEFAULT_MODEL);
	});

	it("invalid/zero max calls per day falls back to default", () => {
		assert.equal(aiConfigFromAdapter({ ai_max_calls_per_day: 0 }).maxCallsPerDay, AI_DEFAULT_MAX_CALLS_PER_DAY);
		assert.equal(aiConfigFromAdapter({ ai_max_calls_per_day: -3 }).maxCallsPerDay, AI_DEFAULT_MAX_CALLS_PER_DAY);
		assert.equal(aiConfigFromAdapter({ ai_max_calls_per_day: "abc" }).maxCallsPerDay, AI_DEFAULT_MAX_CALLS_PER_DAY);
	});

	it("non-object config never throws", () => {
		assert.doesNotThrow(() => aiConfigFromAdapter(null));
		assert.doesNotThrow(() => aiConfigFromAdapter(undefined));
	});
});
