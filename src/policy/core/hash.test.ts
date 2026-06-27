import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computePolicyRevisionHash, stableStringify } from "./hash.js";
import { sortIssuesDeterministic } from "./normalize.js";
import { POLICY_SCHEMA_VERSION, POLICY_ENGINE_VERSION } from "./constants.js";
import type { PolicySnapshot } from "./types.js";

function emptySnapshot(): PolicySnapshot {
	return {
		meta: { schemaVersion: POLICY_SCHEMA_VERSION, engineVersion: POLICY_ENGINE_VERSION },
		capabilities: {},
		limits: {},
		preferences: {},
		protection: {},
		economics: {},
		validation: { valid: true, status: "valid", issues: [] },
		status: "ready",
	};
}

describe("policy hash determinism", () => {
	it("same inputs same hash", () => {
		const a = emptySnapshot();
		const b = emptySnapshot();
		assert.equal(computePolicyRevisionHash(a), computePolicyRevisionHash(b));
	});

	it("key order does not change hash", () => {
		const a = emptySnapshot();
		a.limits = {
			z: { value: 1, source: "admin", strength: "hard", valid: true },
			a: { value: 2, source: "admin", strength: "hard", valid: true },
		};
		const b = emptySnapshot();
		b.limits = {
			a: { value: 2, source: "admin", strength: "hard", valid: true },
			z: { value: 1, source: "admin", strength: "hard", valid: true },
		};
		assert.equal(computePolicyRevisionHash(a), computePolicyRevisionHash(b));
	});

	it("updated_at is not part of hash payload", () => {
		const a = emptySnapshot();
		const b = emptySnapshot();
		(a as { updatedAt?: string }).updatedAt = "2026-01-01";
		assert.equal(computePolicyRevisionHash(a), computePolicyRevisionHash(b));
	});

	it("issues sorted deterministically", () => {
		const issues = sortIssuesDeterministic([
			{ code: "b", severity: "info", message: "m" },
			{ code: "a", severity: "error", message: "m" },
			{ code: "a", severity: "warning", message: "m" },
		]);
		assert.equal(issues[0].severity, "error");
		assert.equal(issues[1].severity, "warning");
	});

	it("stableStringify sorts keys", () => {
		assert.equal(stableStringify({ b: 1, a: 2 }), stableStringify({ a: 2, b: 1 }));
	});
});
