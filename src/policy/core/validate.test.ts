import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { unknownTriState, unknownValue, isValidConfidence } from "./value.js";
import { normalizeTriState, normalizeEnergyPriority } from "./normalize.js";
import { validatePolicySnapshot } from "./validate.js";
import { POLICY_SCHEMA_VERSION, POLICY_ENGINE_VERSION } from "./constants.js";
import { policyValue } from "./value.js";
import type { PolicySnapshot } from "./types.js";

describe("unknown handling", () => {
	it("missing number is not zero", () => {
		const v = unknownValue<number>();
		assert.notEqual(v.value, 0);
		assert.equal(v.value, null);
	});

	it("missing boolean is not false", () => {
		const v = unknownValue<boolean>();
		assert.notEqual(v.value, false);
	});

	it("missing capability is unknown", () => {
		assert.equal(unknownTriState().value, "unknown");
	});

	it("normalizeTriState unknown for garbage", () => {
		assert.equal(normalizeTriState("maybe"), "unknown");
	});
});

describe("policy validation", () => {
	function snap(overrides: Partial<PolicySnapshot> = {}): PolicySnapshot {
		return {
			meta: { schemaVersion: POLICY_SCHEMA_VERSION, engineVersion: POLICY_ENGINE_VERSION },
			capabilities: {},
			limits: {},
			preferences: {},
			protection: {},
			economics: {},
			validation: { valid: true, status: "valid", issues: [] },
			status: "ready",
			...overrides,
		};
	}

	it("min greater than max is error", () => {
		const s = snap({
			limits: {
				minSocPct: policyValue(80, "admin", "hard"),
				maxSocPct: policyValue(70, "admin", "hard"),
			},
		});
		const v = validatePolicySnapshot(s);
		assert.equal(v.valid, false);
		assert.ok(v.issues.some((i) => i.code === "min_greater_than_max"));
	});

	it("rejects NaN", () => {
		const s = snap({
			limits: { x: policyValue(Number.NaN, "admin", "hard") },
		});
		const v = validatePolicySnapshot(s);
		assert.ok(v.issues.some((i) => i.code === "non_finite_number"));
	});

	it("rejects Infinity", () => {
		const s = snap({
			limits: { x: policyValue(Number.POSITIVE_INFINITY, "admin", "hard") },
		});
		const v = validatePolicySnapshot(s);
		assert.ok(v.issues.some((i) => i.code === "non_finite_number"));
	});

	it("invalid confidence detected", () => {
		assert.equal(isValidConfidence(1.5), false);
		const s = snap({
			limits: {
				x: { value: 1, source: "admin", strength: "hard", valid: true, confidence: 2 },
			},
		});
		const v = validatePolicySnapshot(s);
		assert.ok(v.issues.some((i) => i.code === "invalid_confidence"));
	});

	it("invalid mutual exclusion same addon", () => {
		const s = snap({
			protection: {
				mutualExclusions: policyValue(
					[{ id: "x", addonA: "a", addonB: "a" }],
					"admin",
					"hard",
				),
			},
		});
		const v = validatePolicySnapshot(s);
		assert.ok(v.issues.some((i) => i.code === "mutual_exclusion_same_addon"));
	});

	it("negative power rejected", () => {
		const s = snap({
			limits: { houseFuseLimitW: policyValue(-100, "admin", "hard") },
		});
		const v = validatePolicySnapshot(s);
		assert.ok(v.issues.some((i) => i.code === "negative_power_limit"));
	});

	it("energy priority dedupes", () => {
		assert.deepEqual(normalizeEnergyPriority(["pv", "pv", "battery"]), ["pv", "battery"]);
	});
});
