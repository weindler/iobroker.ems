import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { PolicyProviderRegistry } from "./registry.js";
import type { PolicyProvider, PolicySnapshot, PolicyValidationResult } from "./types.js";
import { POLICY_SCHEMA_VERSION, POLICY_ENGINE_VERSION } from "./constants.js";

function testProvider(id: string, addonType: string, instanceId: string): PolicyProvider {
	const empty: PolicySnapshot = {
		meta: {
			schemaVersion: POLICY_SCHEMA_VERSION,
			engineVersion: POLICY_ENGINE_VERSION,
			providerId: id,
			addonType,
			instanceId,
		},
		capabilities: {},
		limits: {},
		preferences: {},
		protection: {},
		economics: {},
		validation: { valid: true, status: "valid", issues: [] },
		status: "ready",
	};
	return {
		id,
		addonType,
		instanceId,
		schemaVersion: POLICY_SCHEMA_VERSION,
		readConfig: async () => ({}),
		readFacts: async () => ({}),
		buildConfiguredPolicy: () => empty,
		buildEffectivePolicy: (c) => c,
		validate: (): PolicyValidationResult => ({ valid: true, status: "valid", issues: [] }),
	};
}

describe("policy provider registry", () => {
	it("registers provider", () => {
		const reg = new PolicyProviderRegistry();
		const r = reg.register(testProvider("t1", "demo", "main"));
		assert.equal(r.ok, true);
		assert.equal(reg.list().length, 1);
	});

	it("stable sort order", () => {
		const reg = new PolicyProviderRegistry();
		reg.register(testProvider("z", "demo", "z"));
		reg.register(testProvider("a", "demo", "a"));
		assert.deepEqual(reg.list().map((p) => p.id), ["a", "z"]);
	});

	it("rejects duplicate id", () => {
		const reg = new PolicyProviderRegistry();
		reg.register(testProvider("dup", "demo", "a"));
		const r = reg.register(testProvider("dup", "demo", "b"));
		assert.equal(r.ok, false);
	});

	it("rejects duplicate addon instance", () => {
		const reg = new PolicyProviderRegistry();
		reg.register(testProvider("p1", "battery", "main"));
		const r = reg.register(testProvider("p2", "battery", "main"));
		assert.equal(r.ok, false);
	});

	it("rejects empty id", () => {
		const reg = new PolicyProviderRegistry();
		const r = reg.register(testProvider("", "demo", "main"));
		assert.equal(r.ok, false);
	});
});
