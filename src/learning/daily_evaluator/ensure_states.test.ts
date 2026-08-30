import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { DAILY_EVALUATOR_STATE_IDS, ensureDailyEvaluatorStates } from "./ensure_states.js";
import type { StateHost } from "../../ems_light/state_util.js";

function makeFakeHost(): StateHost & { objects: Set<string> } {
	const objects = new Set<string>();
	return {
		objects,
		setObjectNotExistsAsync: async (id) => {
			objects.add(id);
		},
		getStateAsync: async () => null,
		setStateAsync: async () => undefined,
	};
}

describe("daily_evaluator ensure_states", () => {
	it("nur minimale, rein lesende Admin-/Visibility-States", () => {
		assert.equal(DAILY_EVALUATOR_STATE_IDS.length, 9);
		assert.ok(DAILY_EVALUATOR_STATE_IDS.every((id) => id.startsWith("learning.daily_evaluator.")));
	});

	it("ensureDailyEvaluatorStates legt Channel + alle States ohne Fehler an", async () => {
		const host = makeFakeHost();
		await ensureDailyEvaluatorStates(host);
		assert.ok(host.objects.has("learning.daily_evaluator"));
		for (const id of DAILY_EVALUATOR_STATE_IDS) {
			assert.ok(host.objects.has(id), `state ${id} wurde nicht angelegt`);
		}
	});
});
