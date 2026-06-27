import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildResolvedAllIntent, nextAggregateRevision } from "./aggregate.js";

const NOW = new Date("2026-06-27T12:00:00Z");

describe("resolved all aggregate", () => {
	it("revision increases on domain semantic change", () => {
		const domainsA = { wallbox: { revision: 1, charge_strategy: { value: "pv" } } };
		const domainsB = { wallbox: { revision: 2, charge_strategy: { value: "off" } } };
		const prev = buildResolvedAllIntent(null, domainsA, NOW);
		const next = buildResolvedAllIntent(prev, domainsB, NOW);
		assert.ok(next.revision > prev.revision);
	});

	it("revision unchanged for identical domains", () => {
		const domains = { thermal: { revision: 1, operating_request: { value: "auto" } } };
		const prev = buildResolvedAllIntent(null, domains, NOW);
		const next = buildResolvedAllIntent(prev, domains, NOW);
		assert.equal(next.revision, prev.revision);
		assert.equal(next.resolved_at, prev.resolved_at);
	});

	it("nextAggregateRevision starts at 1 when domains present", () => {
		assert.equal(nextAggregateRevision(null, { battery: {} }), 1);
	});
});
