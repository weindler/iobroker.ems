import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "./evcc_telemetry";

function mockHost(states: Record<string, unknown>): EvccTelemetryReadHost {
	return {
		async getForeignStateAsync(id: string) {
			if (!(id in states)) return null;
			const val = states[id];
			if (val === "__missing__") return null;
			return { val, ts: Date.now(), ack: true } as ioBroker.State;
		},
		async getStateAsync() {
			return null;
		},
		async setStateAsync() {
			return;
		},
		async setObjectNotExistsAsync() {
			return;
		},
	};
}

describe("wallbox evcc telemetry", () => {
	const now = new Date("2026-06-28T12:00:00.000Z");

	it("reads connected, charging and charge power from EVCC", async () => {
		const snap = await readEvccTelemetrySnapshot(
			mockHost({
				"evcc.0.status.connected": true,
				"evcc.0.status.charging": true,
				"evcc.0.status.chargePower": 3500,
			}),
			{
				enabledStateId: "",
				connectedStateId: "evcc.0.status.connected",
				chargingStateId: "evcc.0.status.charging",
				chargePowerWStateId: "evcc.0.status.chargePower",
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
			},
			now,
		);
		assert.equal(snap.connected.value, true);
		assert.equal(snap.charging.value, true);
		assert.equal(snap.charge_power_w.value, 3500);
	});

	it("reads effectivePlanTime as ISO string", async () => {
		const snap = await readEvccTelemetrySnapshot(
			mockHost({
				"evcc.0.status.effectivePlanTime": 1_751_107_200,
			}),
			{
				enabledStateId: "",
				connectedStateId: "",
				chargingStateId: "",
				chargePowerWStateId: "",
				sessionEnergyKwhStateId: "",
				vehicleSocStateId: "",
				planActiveStateId: "",
				planSocStateId: "",
				planTimeStateId: "",
				effectivePlanTimeStateId: "evcc.0.status.effectivePlanTime",
				activePhasesStateId: "",
				configuredPhasesStateId: "",
				minCurrentAStateId: "",
				maxCurrentAStateId: "",
			},
			now,
		);
		assert.equal(snap.effective_plan_time.status, "valid");
		assert.match(snap.effective_plan_time.value ?? "", /^\d{4}-\d{2}-\d{2}T/);
	});

	it("missing EVCC values stay missing — not false or zero", async () => {
		const snap = await readEvccTelemetrySnapshot(
			mockHost({
				"evcc.0.status.connected": "__missing__",
			}),
			{
				enabledStateId: "evcc.0.status.enabled",
				connectedStateId: "evcc.0.status.connected",
				chargingStateId: "evcc.0.status.charging",
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
			},
			now,
		);
		assert.equal(snap.enabled.status, "missing");
		assert.equal(snap.connected.status, "missing");
		assert.equal(snap.charging.status, "missing");
		assert.equal(snap.enabled.value, null);
		assert.equal(snap.connected.value, null);
	});

	it("legacy go-e write targets do not affect EVCC telemetry read", async () => {
		const snap = await readEvccTelemetrySnapshot(
			mockHost({
				"go-e.0.allow_charging": true,
				"go-e.0.amperePV": 16,
				"evcc.0.status.charging": false,
			}),
			{
				enabledStateId: "",
				connectedStateId: "",
				chargingStateId: "evcc.0.status.charging",
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
			},
			now,
		);
		assert.equal(snap.charging.value, false);
		assert.equal(snap.enabled.status, "missing");
	});
});
