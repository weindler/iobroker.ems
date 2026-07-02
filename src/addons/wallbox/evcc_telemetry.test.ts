import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readEvccTelemetrySnapshot, type EvccTelemetryReadHost } from "./evcc_telemetry";
import type { WallboxEvccTelemetryConfig } from "./evcc_config";

function cfg(over: Partial<WallboxEvccTelemetryConfig> = {}): WallboxEvccTelemetryConfig {
	return {
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
		batteryModeStateId: "",
		batteryDischargeControlStateId: "",
		...over,
	};
}

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
			cfg({
				connectedStateId: "evcc.0.status.connected",
				chargingStateId: "evcc.0.status.charging",
				chargePowerWStateId: "evcc.0.status.chargePower",
			}),
			now,
		);
		assert.equal(snap.connected.value, true);
		assert.equal(snap.charging.value, true);
		assert.equal(snap.charge_power_w.value, 3500);
	});

	it("converts EVCC session energy from Wh to kWh", async () => {
		const snap = await readEvccTelemetrySnapshot(
			mockHost({
				"evcc.0.status.sessionEnergy": 8200,
			}),
			cfg({
				sessionEnergyKwhStateId: "evcc.0.status.sessionEnergy",
			}),
			now,
		);
		assert.equal(snap.session_energy_kwh.status, "valid");
		assert.equal(snap.session_energy_kwh.value, 8.2);
	});

	it("reads effectivePlanTime as ISO string", async () => {
		const snap = await readEvccTelemetrySnapshot(
			mockHost({
				"evcc.0.status.effectivePlanTime": 1_751_107_200,
			}),
			cfg({
				effectivePlanTimeStateId: "evcc.0.status.effectivePlanTime",
			}),
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
			cfg({
				enabledStateId: "evcc.0.status.enabled",
				connectedStateId: "evcc.0.status.connected",
				chargingStateId: "evcc.0.status.charging",
			}),
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
			cfg({
				chargingStateId: "evcc.0.status.charging",
			}),
			now,
		);
		assert.equal(snap.charging.value, false);
		assert.equal(snap.enabled.status, "missing");
	});
});
