import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mergePolicyValues } from "./merge.js";
import { policyValue, unknownTriState, unknownValue } from "./value.js";
import { profileForMode } from "../../global_modes/schema.js";
import { buildConfiguredGlobalPolicy, buildEffectiveGlobalPolicy } from "../global/build.js";
import { globalPolicyConfigFromAdapter } from "../global/config.js";

describe("policy merge", () => {
	it("highest minimum wins", () => {
		const a = policyValue(10, "admin", "hard");
		const b = policyValue(15, "learning", "hard", { confidence: 0.9 });
		const m = mergePolicyValues(a, b, { section: "limits", field: "x", kind: "minimum" });
		assert.equal(m.value, 15);
	});

	it("lowest maximum wins", () => {
		const a = policyValue(5000, "admin", "hard");
		const b = policyValue(4000, "global_mode", "hard");
		const m = mergePolicyValues(a, b, { section: "limits", field: "x", kind: "maximum" });
		assert.equal(m.value, 4000);
	});

	it("hard false beats true", () => {
		const a = policyValue(true, "admin", "hard");
		const b = policyValue(false, "protection", "hard");
		const m = mergePolicyValues(a, b, { section: "protection", field: "x", kind: "hard_boolean" });
		assert.equal(m.value, false);
	});

	it("soft preference from global mode overlays", () => {
		const base = policyValue(0.5, "admin", "soft");
		const overlay = policyValue(0.9, "global_mode", "soft");
		const m = mergePolicyValues(base, overlay, {
			section: "preferences",
			field: "economyWeight",
			kind: "preference",
		});
		assert.equal(m.value, 0.9);
	});

	it("protection is not loosened by forced profile", () => {
		const configured = buildConfiguredGlobalPolicy({
			houseFuseLimitW: 5000,
			maxGridImportW: 5000,
			energyPriority: null,
			mutualExclusions: [{ id: "a", addonA: "battery", addonB: "wallbox" }],
			gridImportAllowed: false,
		});
		const forced = buildEffectiveGlobalPolicy(configured, profileForMode("forced"));
		assert.equal(forced.economics.gridImportAllowed?.value, false);
	});

	it("off disables flexible optimization preference", () => {
		const configured = buildConfiguredGlobalPolicy(globalPolicyConfigFromAdapter({}));
		const off = buildEffectiveGlobalPolicy(configured, profileForMode("off"));
		assert.equal(off.capabilities.flexibleOptimization?.value, false);
	});

	it("learning low confidence does not harden limit", () => {
		const base = policyValue(5000, "admin", "hard");
		const learn = policyValue(3000, "learning", "hard", { confidence: 0.2 });
		const m = mergePolicyValues(base, learn, { section: "limits", field: "max", kind: "maximum" });
		assert.equal(m.value, 5000);
	});

	it("learning sufficient confidence tightens max", () => {
		const base = policyValue(5000, "admin", "hard");
		const learn = policyValue(4600, "learning", "hard", { confidence: 0.8 });
		const m = mergePolicyValues(base, learn, { section: "limits", field: "max", kind: "maximum" });
		assert.equal(m.value, 4600);
	});

	it("empty sources yield neutral unknown", () => {
		const u = unknownValue<number>();
		assert.equal(u.value, null);
		assert.equal(unknownTriState().value, "unknown");
	});
});
