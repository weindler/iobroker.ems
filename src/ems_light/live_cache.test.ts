import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { refreshLiveCache, refreshLivePowerStrip, type LiveCacheHost } from "./live_cache";

class MockHost implements LiveCacheHost {
	config: unknown;
	states = new Map<string, ioBroker.StateValue>();
	foreign = new Map<string, ioBroker.StateValue>();
	writes: string[] = [];

	constructor(config: unknown) {
		this.config = config;
	}

	async setObjectNotExistsAsync(): Promise<void> {
		return;
	}

	async getStateAsync(id: string): Promise<ioBroker.State | null> {
		if (!this.states.has(id)) return null;
		return { val: this.states.get(id) ?? null, ack: true } as ioBroker.State;
	}

	async setStateAsync(id: string, state: ioBroker.SettableState): Promise<void> {
		this.states.set(id, state.val ?? null);
		this.writes.push(id);
	}

	async getForeignStateAsync(id: string): Promise<ioBroker.State | null> {
		if (!this.foreign.has(id)) return null;
		return { val: this.foreign.get(id) ?? null, ack: true } as ioBroker.State;
	}
}

const CONFIG = {
	bat_soc_target: "dev.soc",
	bat_pv_ac_target: "dev.pv",
	bat_consumption_target: "dev.house",
	bat_capacity_kwh_target: "dev.capacity",
	dt_price_now_target: "tibber.price",
	ih_buffer_temp_c_target: "thermal.buffer",
	ih_boiler_temp_c_target: "thermal.boiler",
};

function seededHost(): MockHost {
	const host = new MockHost(CONFIG);
	host.foreign.set("dev.soc", 99);
	host.foreign.set("dev.pv", 1331);
	host.foreign.set("dev.house", 1931);
	host.foreign.set("dev.capacity", 10);
	host.foreign.set("tibber.price", 0.32);
	host.foreign.set("thermal.buffer", 47);
	host.foreign.set("thermal.boiler", 53);
	return host;
}

describe("refreshLivePowerStrip", () => {
	it("writes PV, house, SOC, price and mirrors live.pv.power_w", async () => {
		const host = seededHost();
		const result = await refreshLivePowerStrip(host);
		assert.equal(host.states.get("live.battery.house_load_w"), 1931);
		assert.equal(host.states.get("live.battery.pv_ac_power_w"), 1331);
		assert.equal(host.states.get("live.pv.power_w"), 1331);
		assert.equal(host.states.get("live.battery.soc_pct"), 99);
		assert.equal(host.states.get("live.price.now_ct_per_kwh"), 32);
		assert.equal(host.states.has("live.battery.capacity_kwh"), false);
		assert.equal(host.states.has("live.thermal.buffer_temp_c"), false);
		assert.ok(result.updated.includes("live.pv.power_w"));
	});

	it("skips unchanged values on a second pulse", async () => {
		const host = seededHost();
		await refreshLivePowerStrip(host);
		host.writes = [];
		const second = await refreshLivePowerStrip(host);
		assert.deepEqual(host.writes, []);
		assert.deepEqual(second.updated, []);
	});

	it("writes again when house load changes", async () => {
		const host = seededHost();
		await refreshLivePowerStrip(host);
		host.writes = [];
		host.foreign.set("dev.house", 2100);
		const third = await refreshLivePowerStrip(host);
		assert.equal(host.states.get("live.battery.house_load_w"), 2100);
		assert.ok(third.updated.includes("live.battery.house_load_w"));
		assert.ok(!third.updated.includes("live.pv.power_w"));
	});
});

describe("refreshLiveCache", () => {
	it("still fills thermal and capacity on the slow tick", async () => {
		const host = seededHost();
		await refreshLiveCache(host);
		assert.equal(host.states.get("live.battery.capacity_kwh"), 10);
		assert.equal(host.states.get("live.thermal.buffer_temp_c"), 47);
		assert.equal(host.states.get("live.thermal.boiler_temp_c"), 53);
		assert.equal(host.states.get("live.pv.power_w"), 1331);
	});
});
