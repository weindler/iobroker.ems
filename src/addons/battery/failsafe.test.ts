import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { runBatteryFailsafeCheck, __resetBatteryFailsafeForTest } from "./failsafe.js";
import { touchEmsActivity } from "../../ems_activity.js";
import { BAT } from "./ensure_states.js";

/**
 * Der eigentliche "EMS unreachable" Trip-Pfad wird über `msSinceEmsActivity()`
 * (echte Wall-Clock-Zeit, Mindest-Timeout 60s per `failsafeTimeoutsFromConfig`)
 * ausgelöst und ist damit im Unit-Test nicht ohne künstliche Zeitmanipulation
 * erreichbar — analog zu den bisher ungetesteten Wallbox-/Heizstab-Pendants.
 * Getestet wird hier die erreichbare Logik: Profil-Gate, Mapping-Gate, States.
 */

interface MockState {
	val: ioBroker.StateValue;
}

function mockAdapter(
	config: Record<string, unknown>,
	initialStates: Record<string, MockState> = {},
): { adapter: ioBroker.Adapter; states: Map<string, MockState>; writes: Array<{ id: string; val: ioBroker.StateValue }> } {
	const states = new Map<string, MockState>(Object.entries(initialStates));
	const writes: Array<{ id: string; val: ioBroker.StateValue }> = [];
	const adapter = {
		config,
		log: {
			info: () => undefined,
			warn: () => undefined,
			error: () => undefined,
			debug: () => undefined,
		},
		getStateAsync: async (id: string) => (states.has(id) ? (states.get(id) as ioBroker.State) : null),
		setStateAsync: async (id: string, state: ioBroker.SettableState) => {
			const val = state && typeof state === "object" && "val" in state ? state.val : (state as unknown as ioBroker.StateValue);
			states.set(id, { val: val ?? null });
			return undefined;
		},
		getForeignStateAsync: async (id: string) => (states.has(id) ? (states.get(id) as ioBroker.State) : null),
		setForeignStateAsync: async (id: string, state: ioBroker.SettableState) => {
			const val = state && typeof state === "object" && "val" in state ? state.val : (state as unknown as ioBroker.StateValue);
			writes.push({ id, val: val ?? null });
			states.set(id, { val: val ?? null });
		},
	} as unknown as ioBroker.Adapter;
	return { adapter, states, writes };
}

function liveConfig(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		battery_profile: "sonnen_em",
		bat_operating_mode_target: "device.mode",
		bat_operating_mode_enabled: true,
		bat_battery_charging_target: "device.charge",
		bat_battery_charging_enabled: true,
		...over,
	};
}

describe("runBatteryFailsafeCheck", () => {
	beforeEach(() => {
		__resetBatteryFailsafeForTest();
		touchEmsActivity();
	});

	it("does nothing for profiles without live control (generic_readonly)", async () => {
		const { adapter, writes } = mockAdapter({ battery_profile: "generic_readonly" });
		await runBatteryFailsafeCheck(adapter);
		assert.equal(writes.length, 0);
	});

	it("marks ems_reachable=true and does not trip while activity is recent", async () => {
		const { adapter, writes, states } = mockAdapter(liveConfig(), {
			"global.execution_mode": { val: "live" },
			"addons.battery.mode": { val: "live" },
		});
		await runBatteryFailsafeCheck(adapter);
		assert.equal(writes.length, 0);
		assert.equal(states.get(BAT.failsafe.emsReachable)?.val, true);
		assert.equal(states.get(BAT.failsafe.wouldTrip)?.val, false);
	});

	it("clears a stale failsafe_active flag once reachable again and live", async () => {
		const { adapter, states } = mockAdapter(liveConfig(), {
			"global.execution_mode": { val: "live" },
			"addons.battery.mode": { val: "live" },
			[BAT.failsafe.active]: { val: true },
		});
		await runBatteryFailsafeCheck(adapter);
		assert.equal(states.get(BAT.failsafe.active)?.val, false);
	});

	it("does not clear failsafe_active while not live (would_trip stays diagnostic-only)", async () => {
		const { adapter, states } = mockAdapter(liveConfig(), {
			"global.execution_mode": { val: "dryrun" },
			"addons.battery.mode": { val: "dryrun" },
			[BAT.failsafe.active]: { val: true },
		});
		await runBatteryFailsafeCheck(adapter);
		assert.equal(states.get(BAT.failsafe.active)?.val, true);
	});
});
