import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { estimateCostEur, estimateCostEurFromCharCount } from "./pricing.js";

describe("ai pricing", () => {
	it("zero tokens → zero cost", () => {
		assert.equal(estimateCostEur("gpt-4.1-mini", 0, 0), 0);
		assert.equal(estimateCostEur("gpt-4.1-mini", null, null), 0);
	});

	it("more output tokens cost more than the same input tokens (output is pricier)", () => {
		const inputOnly = estimateCostEur("gpt-4.1-mini", 1000, 0);
		const outputOnly = estimateCostEur("gpt-4.1-mini", 0, 1000);
		assert.ok(outputOnly > inputOnly);
	});

	it("cheap model (gpt-4o-mini) costs less than a pricier model for the same tokens", () => {
		const cheap = estimateCostEur("gpt-4o-mini", 10_000, 2_000);
		const pricier = estimateCostEur("gpt-4.1", 10_000, 2_000);
		assert.ok(cheap < pricier);
	});

	it("char-count estimate returns a positive, finite number for a normal prompt", () => {
		const cost = estimateCostEurFromCharCount("gpt-4.1-mini", 2000);
		assert.ok(Number.isFinite(cost));
		assert.ok(cost > 0);
	});
});
