import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { __resetBatteryRuntimeForTest, runBatteryControlTick } from "./index.js";
import { BAT } from "./ensure_states.js";

const DEVICE_TARGETS = new Set(["dev.mode", "dev.charge"]);

const CONFIG = {
	battery_profile: "sonnen_em",
	bat_hw_max_charge_w: 5000,
	bat_hw_max_discharge_w: 5000,
	bat_hw_min_soc_pct: 5,
	bat_hw_max_soc_pct: 100,
	bat_mode_pause_grid_balance_sec: 0,
	bat_mode_wait_after_mode_sec: 0,
	bat_feedback_timeout_mode_sec: 5,
	bat_feedback_timeout_charge_sec: 5,
	bat_soc_target: "dev.soc",
	bat_power_target: "dev.power",
	bat_operating_mode_target: "dev.mode",
	bat_battery_charging_target: "dev.charge",
	battery_capacity_source: "manual",
	battery_capacity_net_kwh: 10,
};

class MockAdapter {
	rel = new Map<string, ioBroker.StateValue>();
	foreign = new Map<string, ioBroker.StateValue>();
	foreignWrites: Array<{ id: string; val: ioBroker.StateValue }> = [];
	namespace = "ems.0";
	config: unknown;
	log = {
		info: () => undefined,
		warn: () => undefined,
		error: () => undefined,
		debug: () => undefined,
		silly: () => undefined,
		level: "info" as ioBroker.LogLevel,
	};

	constructor(config: unknown) {
		this.config = config;
	}
	async getStateAsync(id: string): Promise<ioBroker.State | null> {
		return this.rel.has(id) ? ({ val: this.rel.get(id) ?? null, ack: true } as ioBroker.State) : null;
	}
	async setStateAsync(id: string, st: ioBroker.SettableState): Promise<void> {
		this.rel.set(id, st.val ?? null);
	}
	async getForeignStateAsync(id: string): Promise<ioBroker.State | null> {
		return this.foreign.has(id)
			? ({ val: this.foreign.get(id) ?? null, ack: true, ts: Date.now() } as ioBroker.State)
			: null;
	}
	async setForeignStateAsync(id: string, st: ioBroker.SettableState): Promise<void> {
		const val = (st as ioBroker.SettableState).val ?? null;
		this.foreignWrites.push({ id, val });
		this.foreign.set(id, val);
	}
}

function setupCharge(global: "dryrun" | "live", govEnabled = true): MockAdapter {
	const a = new MockAdapter(CONFIG);
	a.rel.set("global.execution_mode", global);
	a.rel.set("addons.battery.governance.enabled", govEnabled);
	a.rel.set("ems_mirror.battery_intent_active", true);
	a.rel.set("ems_mirror.operating_mode_target", 1);
	a.rel.set("ems_mirror.charge_power_w_request", 2000);
	a.rel.set("ems_mirror.mode_request_id", 1);
	a.foreign.set("dev.soc", 50);
	a.foreign.set("dev.power", 0);
	a.foreign.set("dev.mode", 2);
	return a;
}

async function runTicks(a: MockAdapter, n: number, simulateDevice: boolean): Promise<void> {
	for (let i = 0; i < n; i++) {
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		if (simulateDevice) {
			// Simulate the device reacting to live writes (charge target → power telemetry).
			if (a.foreign.has("dev.charge")) {
				a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
			}
		}
	}
}

describe("battery control tick — dryrun", () => {
	it("never writes to device datapoints under global dryrun", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("dryrun");
		await runTicks(a, 14, false);
		const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
		assert.equal(deviceWrites.length, 0);
	});

	it("mirrors dryrun intent and reaches active state via simulated feedback", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("dryrun");
		await runTicks(a, 14, false);
		assert.equal(a.rel.get(BAT.dryrun.requestedAction), "charge");
		assert.equal(a.rel.get(BAT.dryrun.effectivePowerW), 2000);
		assert.equal(a.rel.get(BAT.runtime.state), "active");
		assert.equal(a.rel.get(BAT.status.effectiveExecutionMode), "dryrun");
		// Telemetry still mirrored.
		assert.equal(a.rel.get(BAT.telemetry.socPct), 50);
	});
});

describe("battery control tick — live", () => {
	it("writes mode then charge in order through central function", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live");
		await runTicks(a, 14, true);
		const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
		assert.ok(deviceWrites.length >= 2);
		assert.equal(deviceWrites[0].id, "dev.mode");
		assert.equal(deviceWrites[0].val, 1);
		const firstCharge = deviceWrites.find((w) => w.id === "dev.charge");
		assert.equal(firstCharge?.val, 2000);
		assert.equal(a.rel.get(BAT.runtime.state), "active");
	});

	it("battery disabled by governance → no device writes, telemetry still read", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", false);
		await runTicks(a, 14, true);
		const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
		assert.equal(deviceWrites.length, 0);
		assert.equal(a.rel.get(BAT.telemetry.socPct), 50);
	});
});
