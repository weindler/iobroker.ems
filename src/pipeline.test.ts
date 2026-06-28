import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { runCommandPipeline } from "./pipeline.js";
import type { CommandIntent } from "./types.js";

function intent(overrides: Partial<CommandIntent> = {}): CommandIntent {
	return {
		addon_id: "immersion_heater",
		command: "set_enabled",
		value: true,
		...overrides,
	};
}

function mockCtx(states: Record<string, ioBroker.StateValue>, live = true) {
	const store = new Map(Object.entries(states));
	let foreignWrites = 0;
	return {
		foreignWrites,
		ctx: {
			getState: async (id: string) => {
				const val = store.get(id);
				return val === undefined ? null : ({ val } as ioBroker.State);
			},
			setForeignState: async () => {
				foreignWrites++;
			},
			isLiveAllowed: async () => live,
		},
	};
}

describe("pipeline governance gates", () => {
	it("blocks disabled governed addon before live write", async () => {
		const { ctx, foreignWrites } = mockCtx({
			"addons.immersion_heater.available": true,
			"addons.immersion_heater.enabled": false,
			"addons.immersion_heater.governance.enabled": false,
			"addons.immersion_heater.mode": "live",
			"addons.immersion_heater.mapping.set_enabled.enabled": true,
			"addons.immersion_heater.mapping.set_enabled.target_state": "mqtt.0.relay",
			"addons.immersion_heater.mapping.set_enabled.allowed_values": "[true,false]",
		});
		const outcome = await runCommandPipeline(intent(), ctx);
		assert.equal(outcome.result, "blocked");
		assert.ok(outcome.checks_failed.includes("addon_disabled"));
		assert.equal(foreignWrites, 0);
	});

	it("blocks governance-disabled addon at final live write gate", async () => {
		const { ctx, foreignWrites } = mockCtx({
			"addons.immersion_heater.available": true,
			"addons.immersion_heater.enabled": true,
			"addons.immersion_heater.governance.enabled": false,
			"addons.immersion_heater.mode": "live",
			"addons.immersion_heater.mapping.set_enabled.enabled": true,
			"addons.immersion_heater.mapping.set_enabled.target_state": "mqtt.0.relay",
			"addons.immersion_heater.mapping.set_enabled.allowed_values": "[true,false]",
			"global.execution_mode": "live",
		});
		const outcome = await runCommandPipeline(intent(), ctx);
		assert.equal(outcome.result, "blocked");
		assert.ok(outcome.checks_failed.includes("addon_governance_disabled"));
		assert.equal(foreignWrites, 0);
	});
});
