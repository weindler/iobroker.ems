import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	addonGovernanceAiAllowedState,
	addonGovernanceEnabledState,
	ensureAddonGovernanceStates,
	syncAddonGovernanceFromConfig,
} from "./ensure_states.js";
import { governedAddonIds } from "./registry.js";

type MemState = { val: ioBroker.StateValue; ack: boolean };

function mockHost(initial: Record<string, MemState> = {}) {
	const objects = new Set<string>();
	const states = new Map<string, MemState>(Object.entries(initial));
	return {
		objects,
		states,
		host: {
			setObjectNotExistsAsync: async (id: string) => {
				objects.add(id);
			},
			getStateAsync: async (id: string) => states.get(id) ?? null,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				states.set(id, { val: st.val as ioBroker.StateValue, ack: st.ack === true });
			},
		},
	};
}

describe("addon governance runtime states", () => {
	it("creates governance states for all addons", async () => {
		const mock = mockHost();
		await ensureAddonGovernanceStates(mock.host as import("../../ems_light/state_util.js").StateHost);
		for (const id of governedAddonIds()) {
			assert.ok(mock.objects.has(addonGovernanceEnabledState(id)));
			assert.ok(mock.objects.has(addonGovernanceAiAllowedState(id)));
		}
	});

	it("mirrors config with ack=true and only writes on change", async () => {
		const initial: Record<string, MemState> = {};
		for (const id of governedAddonIds()) {
			initial[addonGovernanceEnabledState(id)] = { val: true, ack: true };
			initial[addonGovernanceAiAllowedState(id)] = { val: false, ack: true };
		}
		initial["addons.wallbox.enabled"] = { val: true, ack: true };
		initial["addons.immersion_heater.enabled"] = { val: true, ack: true };
		initial["addons.battery.enabled"] = { val: true, ack: true };
		initial["addons.air_conditioning.enabled"] = { val: true, ack: true };
		const mock = mockHost(initial);
		const { states } = mock;
		let writes = 0;
		const countingHost = {
			...mock.host,
			setStateAsync: async (id: string, st: ioBroker.SettableState) => {
				writes++;
				return mock.host.setStateAsync(id, st);
			},
		} as import("../../ems_light/state_util.js").StateHost;
		await syncAddonGovernanceFromConfig(countingHost, {
			wallbox_enabled: true,
			wallbox_ai_optimization_allowed: false,
		});
		assert.equal(writes, 0);

		await syncAddonGovernanceFromConfig(countingHost, {
			wallbox_enabled: false,
			wallbox_ai_optimization_allowed: true,
		});
		assert.equal(states.get("addons.wallbox.governance.enabled")?.val, false);
		assert.equal(states.get("addons.wallbox.governance.enabled")?.ack, true);
		assert.equal(states.get("addons.wallbox.governance.ai_optimization_allowed")?.val, true);
		assert.equal(states.get("addons.wallbox.enabled")?.val, false);
	});
});
