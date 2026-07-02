"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const evcc_battery_js_1 = require("./evcc_battery.js");
const NOW = new Date("2026-06-27T12:00:00Z");
class MockHost {
    foreign = new Map();
    async getForeignStateAsync(id) {
        if (!this.foreign.has(id))
            return null;
        return { val: this.foreign.get(id) ?? null, ack: true, ts: Date.now() };
    }
    async getStateAsync() {
        return null;
    }
    async setStateAsync() {
        return;
    }
    async setObjectNotExistsAsync() {
        return;
    }
}
const CFG = {
    enabledStateId: "",
    connectedStateId: "",
    chargingStateId: "",
    chargePowerWStateId: "",
    sessionEnergyKwhStateId: "",
    vehicleSocStateId: "",
    planActiveStateId: "",
    planSocStateId: "",
    planTimeStateId: "",
    effectivePlanTimeStateId: "",
    activePhasesStateId: "",
    configuredPhasesStateId: "",
    minCurrentAStateId: "",
    maxCurrentAStateId: "",
    batteryModeStateId: "evcc.0.status.batteryMode",
    batteryDischargeControlStateId: "evcc.0.status.batteryDischargeControl",
};
(0, node_test_1.describe)("evcc battery intent snapshot", () => {
    (0, node_test_1.it)("returns empty when discharge control disabled", async () => {
        const host = new MockHost();
        host.foreign.set("evcc.0.status.batteryDischargeControl", false);
        host.foreign.set("evcc.0.status.batteryMode", "hold");
        const snap = await (0, evcc_battery_js_1.readEvccBatteryIntentSnapshot)(host, CFG, NOW);
        strict_1.default.equal(snap.operating_request, null);
    });
    (0, node_test_1.it)("maps hold when discharge control enabled", async () => {
        const host = new MockHost();
        host.foreign.set("evcc.0.status.batteryDischargeControl", true);
        host.foreign.set("evcc.0.status.batteryMode", "hold");
        const snap = await (0, evcc_battery_js_1.readEvccBatteryIntentSnapshot)(host, CFG, NOW);
        strict_1.default.equal(snap.operating_request?.value, "hold");
        strict_1.default.equal(snap.ev_discharge_allowed?.value, false);
    });
    (0, node_test_1.it)("ignores normal mode", async () => {
        const host = new MockHost();
        host.foreign.set("evcc.0.status.batteryDischargeControl", true);
        host.foreign.set("evcc.0.status.batteryMode", "normal");
        const snap = await (0, evcc_battery_js_1.readEvccBatteryIntentSnapshot)(host, CFG, NOW);
        strict_1.default.equal(snap.operating_request, null);
    });
});
