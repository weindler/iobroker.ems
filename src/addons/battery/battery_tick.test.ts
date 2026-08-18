import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { __resetBatteryRuntimeForTest, runBatteryControlTick } from "./index.js";
import { BAT } from "./ensure_states.js";
import { getBatterySetpointSession } from "./runtime/setpoint_session.js";
import { WALLBOX_EV_FOUNDATION_STATES } from "../wallbox/ev_foundation/ensure_states.js";
import { WALLBOX_EVCC_STATES } from "../wallbox/ensure_evcc_states.js";
import { WALLBOX_RUNTIME_STATES } from "../wallbox/runtime/states.js";

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
	bat_charging_power_target: "dev.charge",
	battery_capacity_source: "manual",
	battery_capacity_net_kwh: 10,
};

class MockAdapter {
	rel = new Map<string, ioBroker.StateValue>();
	relTs = new Map<string, number>();
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
		if (!this.rel.has(id)) return null;
		return {
			val: this.rel.get(id) ?? null,
			ack: true,
			ts: this.relTs.get(id) ?? Date.now(),
		} as ioBroker.State;
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

function setupCharge(
	global: "dryrun" | "live",
	govEnabled = true,
	addonMode: "off" | "dryrun" | "live" = global,
): MockAdapter {
	const a = new MockAdapter(CONFIG);
	a.rel.set("global.execution_mode", global);
	a.rel.set("addons.battery.mode", addonMode);
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
		assert.equal(a.rel.get(BAT.runtime.action), "charge");
		assert.equal(a.rel.get(BAT.runtime.batterySetpointW), 2000);
		assert.equal(a.rel.get(BAT.runtime.state), "active");
		assert.equal(a.rel.get(BAT.status.effectiveExecutionMode), "dryrun");
		// Telemetry still mirrored.
		assert.equal(a.rel.get(BAT.telemetry.socPct), 50);
	});
});

describe("battery control tick — live", () => {
	it("writes mode then charge in order through central function", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
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

	it("global live but addon dryrun → no device writes", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "dryrun");
		await runTicks(a, 14, true);
		const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
		assert.equal(deviceWrites.length, 0);
		assert.equal(a.rel.get(BAT.status.effectiveExecutionMode), "dryrun");
	});

	it("dryrun progress discarded when live write becomes allowed", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("dryrun", true, "dryrun");
		await runTicks(a, 14, false);
		assert.equal(a.rel.get(BAT.runtime.state), "active");
		a.rel.set("global.execution_mode", "live");
		a.rel.set("addons.battery.mode", "live");
		await runTicks(a, 14, true);
		const modeWrites = a.foreignWrites.filter((w) => w.id === "dev.mode");
		assert.ok(modeWrites.length >= 1);
		assert.equal(modeWrites[0].val, 1);
	});
});

describe("battery control tick — LIVE → OFF ownership handover", () => {
	it("live ownership → off: one restore cycle, then 0 further device writes", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		await runTicks(a, 14, true);
		assert.equal(a.rel.get(BAT.runtime.state), "active");
		assert.equal(a.rel.get(BAT.runtime.ownershipActive), true);

		const writesBeforeOff = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id)).length;
		a.rel.set("addons.battery.mode", "off");
		// Drive restore: charge→0, mode→self-consumption (2)
		for (let i = 0; i < 20; i++) {
			await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
			if (a.foreign.has("dev.charge")) {
				a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
			}
			if (a.rel.get(BAT.runtime.ownershipActive) !== true) break;
		}
		const restoreWrites = a.foreignWrites.slice(writesBeforeOff).filter((w) => DEVICE_TARGETS.has(w.id));
		assert.ok(restoreWrites.length >= 1, "restore must write at least charge stop / mode");
		assert.ok(
			restoreWrites.some((w) => w.id === "dev.charge" && w.val === 0) ||
				restoreWrites.some((w) => w.id === "dev.mode" && w.val === 2),
			"restore cycle must stop charge or set self-consumption",
		);
		assert.equal(a.rel.get(BAT.runtime.ownershipActive), false);

		const afterRestore = a.foreignWrites.length;
		await runTicks(a, 10, true);
		const further = a.foreignWrites.slice(afterRestore).filter((w) => DEVICE_TARGETS.has(w.id));
		assert.equal(further.length, 0, "after OFF handover: no further battery device writes");
	});

	it("off without ownership → 0 device writes", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "off");
		a.rel.set("ems_mirror.battery_intent_active", true);
		await runTicks(a, 14, true);
		const deviceWrites = a.foreignWrites.filter((w) => DEVICE_TARGETS.has(w.id));
		assert.equal(deviceWrites.length, 0);
		assert.equal(a.rel.get(BAT.runtime.ownershipActive), false);
	});
});

describe("battery setpoint release safety", () => {
	it("regular end after own >0 write: exactly one 0 W, diagnosis cleared", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		await runTicks(a, 14, true);
		assert.equal(a.rel.get(BAT.runtime.state), "active");
		assert.equal(a.rel.get(BAT.runtime.batterySetpointOwner), "planned_charge");
		assert.equal(a.rel.get(BAT.runtime.batterySetpointW), 2000);

		const before = a.foreignWrites.length;
		a.rel.set("ems_mirror.battery_intent_active", false);
		a.rel.set("ems_mirror.operating_mode_target", 2);
		a.rel.set("ems_mirror.charge_power_w_request", 0);
		for (let i = 0; i < 20; i++) {
			await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
			if (a.foreign.has("dev.charge")) a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
			if (a.rel.get(BAT.runtime.ownershipActive) !== true) break;
		}
		const zeros = a.foreignWrites.slice(before).filter((w) => w.id === "dev.charge" && w.val === 0);
		assert.equal(zeros.length, 1);
		assert.equal(a.rel.get(BAT.runtime.batterySetpointOwner), "none");
		assert.equal(a.rel.get(BAT.runtime.batterySetpointW), 0);
		assert.equal(getBatterySetpointSession().releasePending, false);
		assert.ok(String(getBatterySetpointSession().lastReleaseAt ?? "").length > 0);
	});

	it("stale planner Hold constraint does not set hold_detected", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		const staleTs = Date.now() - 16 * 60 * 1000;
		a.rel.set("planner.constraints.battery_hold_active", true);
		a.relTs.set("planner.constraints.battery_hold_active", staleTs);
		a.rel.set("planner.constraints.evcc_battery_hold", true);
		a.relTs.set("planner.constraints.evcc_battery_hold", staleTs);
		a.rel.set(WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
		a.rel.set(WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
		a.rel.set(WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, false);
		a.rel.set(WALLBOX_EVCC_STATES.batteryDischargeControl, false);
		a.rel.set(WALLBOX_EVCC_STATES.batteryMode, "normal");
		a.rel.set(WALLBOX_EVCC_STATES.connected, false);
		a.rel.set(WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
		a.rel.set(WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "none");
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		assert.equal(a.rel.get(BAT.gridBalance.holdDetected), false);
	});

	it("discharge control alone does not set hold_detected (live case)", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		a.rel.set("planner.constraints.battery_hold_active", false);
		a.rel.set(WALLBOX_EVCC_STATES.batteryDischargeControl, true);
		a.rel.set(WALLBOX_EVCC_STATES.batteryMode, "unknown");
		a.rel.set(WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
		a.rel.set(WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
		a.rel.set(WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, false);
		a.rel.set(WALLBOX_EVCC_STATES.connected, false);
		a.rel.set(WALLBOX_EVCC_STATES.charging, false);
		a.rel.set(WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
		a.rel.set(WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "none");
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		assert.equal(a.rel.get(BAT.gridBalance.holdDetected), false);
	});

	it("EVCC battery_mode hold sets hold_detected", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		a.rel.set("planner.constraints.battery_hold_active", false);
		a.rel.set(WALLBOX_EVCC_STATES.batteryDischargeControl, true);
		a.rel.set(WALLBOX_EVCC_STATES.batteryMode, "hold");
		a.rel.set(WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		assert.equal(a.rel.get(BAT.gridBalance.holdDetected), true);
	});

	it("EVCC battery_mode holdcharge sets hold_detected", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		a.rel.set("planner.constraints.battery_hold_active", false);
		a.rel.set(WALLBOX_EVCC_STATES.batteryDischargeControl, true);
		a.rel.set(WALLBOX_EVCC_STATES.batteryMode, "holdcharge");
		a.rel.set(WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, false);
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		assert.equal(a.rel.get(BAT.gridBalance.holdDetected), true);
	});

	it("current EV-charge Hold sets hold_detected", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		a.rel.set("planner.constraints.battery_hold_active", false);
		a.rel.set(WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, true);
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		assert.equal(a.rel.get(BAT.gridBalance.holdDetected), true);
	});

	it("leftover EVCC now with disconnected vehicle does not invent EV hold/conflict", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		a.rel.set("planner.constraints.battery_hold_active", false);
		a.rel.set(WALLBOX_RUNTIME_STATES.batteryHoldForEvCharge, true);
		a.rel.set(WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
		a.rel.set(WALLBOX_RUNTIME_STATES.externalVehicleChargeActive, false);
		a.rel.set(WALLBOX_EVCC_STATES.batteryDischargeControl, false);
		a.rel.set(WALLBOX_EVCC_STATES.batteryMode, "normal");
		a.rel.set(WALLBOX_EVCC_STATES.loadpointMode, "now");
		a.rel.set(WALLBOX_EVCC_STATES.connected, false);
		a.rel.set(WALLBOX_EVCC_STATES.charging, false);
		a.rel.set(WALLBOX_EVCC_STATES.chargePowerW, 0);
		a.rel.set(WALLBOX_RUNTIME_STATES.tibberGridRewardsActive, false);
		a.rel.set(WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "none");
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		assert.equal(a.rel.get(BAT.gridBalance.holdDetected), false);
		assert.equal(a.rel.get(BAT.gridBalance.evConflict), false);
	});

	it("grid_charge/hold: no competing 0 W against Hold", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		await runTicks(a, 14, true);
		assert.equal(a.rel.get(BAT.runtime.state), "active");
		const before = a.foreignWrites.length;
		a.rel.set("planner.constraints.battery_hold_active", true);
		for (let i = 0; i < 8; i++) {
			await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
			if (a.foreign.has("dev.charge")) a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
		}
		const after = a.foreignWrites.slice(before).filter((w) => DEVICE_TARGETS.has(w.id));
		assert.equal(
			after.filter((w) => w.id === "dev.charge" && w.val === 0).length,
			0,
			"Hold takeover must not write 0 W",
		);
		assert.equal(after.filter((w) => w.id === "dev.mode" && w.val === 2).length, 0);
		assert.equal(a.rel.get(BAT.runtime.batterySetpointOwner), "none");
		assert.equal(String(getBatterySetpointSession().releaseReason), "handover_hold");
	});

	it("grid_charge/external: no competing 0 W against External", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		await runTicks(a, 14, true);
		const before = a.foreignWrites.length;
		a.rel.set(WALLBOX_EV_FOUNDATION_STATES.evExecutionAuthority, "external");
		for (let i = 0; i < 8; i++) {
			await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		}
		const zeros = a.foreignWrites
			.slice(before)
			.filter((w) => w.id === "dev.charge" && w.val === 0);
		assert.equal(zeros.length, 0);
		assert.equal(a.rel.get(BAT.runtime.batterySetpointOwner), "none");
		assert.equal(String(getBatterySetpointSession().releaseReason), "handover_external");
	});

	it("Live → Dryrun during live charge: 0 W restore write", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		await runTicks(a, 14, true);
		assert.equal(a.rel.get(BAT.runtime.batterySetpointOwner), "planned_charge");
		const before = a.foreignWrites.length;
		a.rel.set("global.execution_mode", "dryrun");
		a.rel.set("addons.battery.mode", "dryrun");
		for (let i = 0; i < 20; i++) {
			await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
			if (a.foreign.has("dev.charge")) a.foreign.set("dev.power", a.foreign.get("dev.charge") ?? 0);
			if (a.rel.get(BAT.runtime.ownershipActive) !== true) break;
		}
		const zeros = a.foreignWrites.slice(before).filter((w) => w.id === "dev.charge" && w.val === 0);
		assert.equal(zeros.length, 1);
		assert.equal(a.rel.get(BAT.runtime.batterySetpointOwner), "none");
	});

	it("adapter restart leftover setpoint without ownership: no blind 0 W", async () => {
		__resetBatteryRuntimeForTest();
		const a = setupCharge("live", true, "live");
		a.rel.set("ems_mirror.battery_intent_active", false);
		a.rel.set("ems_mirror.operating_mode_target", 2);
		a.rel.set("ems_mirror.charge_power_w_request", 0);
		a.foreign.set("dev.charge", 2000);
		a.foreign.set("dev.power", 0);
		a.foreign.set("dev.mode", 2);
		await runTicks(a, 8, true);
		const zeros = a.foreignWrites.filter((w) => w.id === "dev.charge" && w.val === 0);
		assert.equal(zeros.length, 0);
		assert.equal(a.rel.get(BAT.runtime.batterySetpointOwner), "none");
		assert.equal(a.rel.get(BAT.runtime.ownershipActive), false);
	});
});

describe("battery control tick — live power strip", () => {
	it("publishes mapped PV/house/SOC onto live.* for the dashboard", async () => {
		__resetBatteryRuntimeForTest();
		const a = new MockAdapter({
			...CONFIG,
			bat_consumption_target: "dev.house",
			bat_pv_ac_target: "dev.pv",
		});
		a.rel.set("global.execution_mode", "dryrun");
		a.rel.set("addons.battery.mode", "dryrun");
		a.rel.set("addons.battery.governance.enabled", true);
		a.foreign.set("dev.soc", 99);
		a.foreign.set("dev.power", 0);
		a.foreign.set("dev.mode", 2);
		a.foreign.set("dev.house", 1931);
		a.foreign.set("dev.pv", 1331);
		await runBatteryControlTick(a as unknown as ioBroker.Adapter & { config: unknown });
		assert.equal(a.rel.get("live.battery.house_load_w"), 1931);
		assert.equal(a.rel.get("live.battery.pv_ac_power_w"), 1331);
		assert.equal(a.rel.get("live.pv.power_w"), 1331);
		assert.equal(a.rel.get("live.battery.soc_pct"), 99);
	});
});
