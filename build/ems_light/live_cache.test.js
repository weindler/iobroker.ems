"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const live_cache_1 = require("./live_cache");
class MockHost {
    config;
    states = new Map();
    foreign = new Map();
    writes = [];
    constructor(config) {
        this.config = config;
    }
    async setObjectNotExistsAsync() {
        return;
    }
    async getStateAsync(id) {
        if (!this.states.has(id))
            return null;
        return { val: this.states.get(id) ?? null, ack: true };
    }
    async setStateAsync(id, state) {
        this.states.set(id, state.val ?? null);
        this.writes.push(id);
    }
    async getForeignStateAsync(id) {
        if (!this.foreign.has(id))
            return null;
        return { val: this.foreign.get(id) ?? null, ack: true };
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
function seededHost() {
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
(0, node_test_1.describe)("refreshLivePowerStrip", () => {
    (0, node_test_1.it)("writes PV, house, SOC, price and mirrors live.pv.power_w", async () => {
        const host = seededHost();
        const result = await (0, live_cache_1.refreshLivePowerStrip)(host);
        strict_1.default.equal(host.states.get("live.battery.house_load_w"), 1931);
        strict_1.default.equal(host.states.get("live.battery.pv_ac_power_w"), 1331);
        strict_1.default.equal(host.states.get("live.pv.power_w"), 1331);
        strict_1.default.equal(host.states.get("live.battery.soc_pct"), 99);
        strict_1.default.equal(host.states.get("live.price.now_ct_per_kwh"), 32);
        host.foreign.set("tibber.price", 0.3305);
        await (0, live_cache_1.refreshLivePowerStrip)(host);
        strict_1.default.equal(host.states.get("live.price.now_ct_per_kwh"), 33.1);
        strict_1.default.equal(host.states.has("live.battery.capacity_kwh"), false);
        strict_1.default.equal(host.states.has("live.thermal.buffer_temp_c"), false);
        strict_1.default.ok(result.updated.includes("live.pv.power_w"));
    });
    (0, node_test_1.it)("skips unchanged values on a second pulse", async () => {
        const host = seededHost();
        await (0, live_cache_1.refreshLivePowerStrip)(host);
        host.writes = [];
        const second = await (0, live_cache_1.refreshLivePowerStrip)(host);
        strict_1.default.deepEqual(host.writes, []);
        strict_1.default.deepEqual(second.updated, []);
    });
    (0, node_test_1.it)("writes again when house load changes", async () => {
        const host = seededHost();
        await (0, live_cache_1.refreshLivePowerStrip)(host);
        host.writes = [];
        host.foreign.set("dev.house", 2100);
        const third = await (0, live_cache_1.refreshLivePowerStrip)(host);
        strict_1.default.equal(host.states.get("live.battery.house_load_w"), 2100);
        strict_1.default.ok(third.updated.includes("live.battery.house_load_w"));
        strict_1.default.ok(!third.updated.includes("live.pv.power_w"));
    });
});
(0, node_test_1.describe)("refreshLiveCache", () => {
    (0, node_test_1.it)("still fills thermal and capacity on the slow tick", async () => {
        const host = seededHost();
        await (0, live_cache_1.refreshLiveCache)(host);
        strict_1.default.equal(host.states.get("live.battery.capacity_kwh"), 10);
        strict_1.default.equal(host.states.get("live.thermal.buffer_temp_c"), 47);
        strict_1.default.equal(host.states.get("live.thermal.boiler_temp_c"), 53);
        strict_1.default.equal(host.states.get("live.pv.power_w"), 1331);
    });
});
