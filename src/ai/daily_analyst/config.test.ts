import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { aiAnalystConfigFromAdapter, AI_ANALYST_DEFAULT_MODEL } from "./config";

describe("aiAnalystConfigFromAdapter", () => {
	it("Admin deaktiviert → mode disabled, Overrides bleiben aus", () => {
		const cfg = aiAnalystConfigFromAdapter({
			ai_analyst_mode: "disabled",
			ai_openai_api_key: "sk-test",
			ai_override_enabled: true,
		});
		assert.equal(cfg.mode, "disabled");
		assert.equal(cfg.overrideEnabled, true);
		assert.equal(cfg.apiKey, "sk-test");
	});

	it("Admin Nur manuell → mode manual", () => {
		const cfg = aiAnalystConfigFromAdapter({ ai_analyst_mode: "manual" });
		assert.equal(cfg.mode, "manual");
		assert.equal(cfg.overrideEnabled, false);
		assert.equal(cfg.model, AI_ANALYST_DEFAULT_MODEL);
	});

	it("Admin Automatisch täglich → mode daily_auto", () => {
		const cfg = aiAnalystConfigFromAdapter({ ai_analyst_mode: " daily_auto " });
		assert.equal(cfg.mode, "daily_auto");
	});

	it("fehlender/ungültiger Modus fällt auf disabled, Token nicht erfunden", () => {
		assert.equal(aiAnalystConfigFromAdapter({}).mode, "disabled");
		assert.equal(aiAnalystConfigFromAdapter({ ai_analyst_mode: "on" }).mode, "disabled");
		assert.equal(aiAnalystConfigFromAdapter({ ai_analyst_mode: "manual" }).apiKey, "");
		assert.equal(aiAnalystConfigFromAdapter(null).mode, "disabled");
	});
});
