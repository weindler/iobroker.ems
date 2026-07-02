import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readEvccBatteryIntentSnapshot } from "./evcc_battery.js";
import type { WallboxEvccTelemetryConfig } from "../../addons/wallbox/evcc_config.js";

const NOW = new Date("2026-06-27T12:00:00Z");

class MockHost {
	foreign = new Map<string, ioBroker.StateValue>();

	async getForeignStateAsync(id: string): Promise<ioBroker.State | null> {
		if (!this.foreign.has(id)) return null;
		return { val: this.foreign.get(id) ?? null, ack: true, ts: Date.now() } as ioBroker.State;
	}

	async getStateAsync(): Promise<ioBroker.State | null> {
		return null;
	}

	async setStateAsync(): Promise<void> {
		return;
	}

	async setObjectNotExistsAsync(): Promise<void> {
		return;
	}
}

const CFG: WallboxEvccTelemetryConfig = {
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

describe("evcc battery intent snapshot", () => {
	it("returns empty when discharge control disabled", async () => {
		const host = new MockHost();
		host.foreign.set("evcc.0.status.batteryDischargeControl", false);
		host.foreign.set("evcc.0.status.batteryMode", "hold");
		const snap = await readEvccBatteryIntentSnapshot(host, CFG, NOW);
		assert.equal(snap.operating_request, null);
	});

	it("maps hold when discharge control enabled", async () => {
		const host = new MockHost();
		host.foreign.set("evcc.0.status.batteryDischargeControl", true);
		host.foreign.set("evcc.0.status.batteryMode", "hold");
		const snap = await readEvccBatteryIntentSnapshot(host, CFG, NOW);
		assert.equal(snap.operating_request?.value, "hold");
		assert.equal(snap.ev_discharge_allowed?.value, false);
	});

	it("ignores normal mode", async () => {
		const host = new MockHost();
		host.foreign.set("evcc.0.status.batteryDischargeControl", true);
		host.foreign.set("evcc.0.status.batteryMode", "normal");
		const snap = await readEvccBatteryIntentSnapshot(host, CFG, NOW);
		assert.equal(snap.operating_request, null);
	});
});
