import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { evaluateStopCondition, type StopConditionInput } from "./safety.js";

function okInput(): StopConditionInput {
	return {
		targetSocReached: false,
		intentExpired: false,
		intentRevoked: false,
		addonDisabled: false,
		globalLeftLive: false,
		safetyBlocked: false,
		telemetryStale: false,
		communicationLost: false,
		fault: false,
		unloading: false,
		higherPriorityIntent: false,
	};
}

describe("evaluateStopCondition", () => {
	it("returns null when nothing applies", () => {
		assert.equal(evaluateStopCondition(okInput()), null);
	});

	it("fault has the highest priority", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), fault: true, communicationLost: true, unloading: true }),
			"fault",
		);
	});

	it("communication_lost outranks addon_disabled/global_left_live", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), communicationLost: true, addonDisabled: true }),
			"communication_lost",
		);
	});

	it("adapter_unload outranks addon_disabled", () => {
		assert.equal(evaluateStopCondition({ ...okInput(), unloading: true, addonDisabled: true }), "adapter_unload");
	});

	it("addon_disabled outranks global_left_live", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), addonDisabled: true, globalLeftLive: true }),
			"addon_disabled",
		);
	});

	it("global_left_live outranks safety_blocked", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), globalLeftLive: true, safetyBlocked: true }),
			"global_left_live",
		);
	});

	it("safety_blocked (hardware SOC ceiling) outranks telemetry_stale", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), safetyBlocked: true, telemetryStale: true }),
			"safety_blocked",
		);
	});

	it("telemetry_stale outranks intent_revoked", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), telemetryStale: true, intentRevoked: true }),
			"telemetry_stale",
		);
	});

	it("intent_revoked outranks intent_expired", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), intentRevoked: true, intentExpired: true }),
			"intent_revoked",
		);
	});

	it("intent_expired outranks target_soc_reached", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), intentExpired: true, targetSocReached: true }),
			"intent_expired",
		);
	});

	it("target_soc_reached outranks higher_priority_intent", () => {
		assert.equal(
			evaluateStopCondition({ ...okInput(), targetSocReached: true, higherPriorityIntent: true }),
			"target_soc_reached",
		);
	});

	it("higher_priority_intent is the lowest-priority stop reason", () => {
		assert.equal(evaluateStopCondition({ ...okInput(), higherPriorityIntent: true }), "higher_priority_intent");
	});
});
