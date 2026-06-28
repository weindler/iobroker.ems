import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isAddonAiOptimizationAllowed } from "../governance/config.js";

describe("ai optimization governance", () => {
	it("ai flag does not imply enabled steering", () => {
		const config = {
			wallbox_enabled: false,
			wallbox_ai_optimization_allowed: true,
		};
		assert.equal(isAddonAiOptimizationAllowed(config, "wallbox"), true);
	});
});
