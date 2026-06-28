import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
	configuredEvccTelemetryStateIds,
	hasLegacyWallboxWriteMapping,
	wallboxEvccTelemetryConfigFromAdapter,
	wallboxEvccTelemetryMappingFromConfig,
} from "./evcc_config";

describe("wallbox evcc_config", () => {
	it("parses wb_evcc telemetry state ids", () => {
		const cfg = wallboxEvccTelemetryConfigFromAdapter({
			wb_evcc_connected_state: "evcc.0.status.connected",
			wb_evcc_charging_state: "evcc.0.status.charging",
			wb_evcc_charge_power_w_state: "evcc.0.status.chargePower",
		});
		assert.equal(cfg.connectedStateId, "evcc.0.status.connected");
		assert.equal(cfg.chargingStateId, "evcc.0.status.charging");
		assert.equal(cfg.chargePowerWStateId, "evcc.0.status.chargePower");
		assert.deepEqual(configuredEvccTelemetryStateIds(cfg), [
			"evcc.0.status.connected",
			"evcc.0.status.charging",
			"evcc.0.status.chargePower",
		]);
	});

	it("falls back to legacy wb_vehicle_soc_target for vehicle soc", () => {
		const cfg = wallboxEvccTelemetryConfigFromAdapter({
			wb_vehicle_soc_target: "evcc.0.status.vehicleSoc",
		});
		assert.equal(cfg.vehicleSocStateId, "evcc.0.status.vehicleSoc");
	});

	it("prefers wb_evcc_vehicle_soc over legacy", () => {
		const cfg = wallboxEvccTelemetryConfigFromAdapter({
			wb_evcc_vehicle_soc_state: "evcc.0.status.vehicleSoc",
			wb_vehicle_soc_target: "go-e.0.soc",
		});
		assert.equal(cfg.vehicleSocStateId, "evcc.0.status.vehicleSoc");
	});

	it("builds mapping entries for configured telemetry", () => {
		const m = wallboxEvccTelemetryMappingFromConfig({
			wb_evcc_enabled_state: "evcc.0.status.enabled",
		});
		assert.deepEqual(m.evcc_enabled, { enabled: true, target_state: "evcc.0.status.enabled" });
	});

	it("detects legacy go-e write mappings", () => {
		assert.equal(hasLegacyWallboxWriteMapping({}), false);
		assert.equal(hasLegacyWallboxWriteMapping({ wb_set_enabled_target: "go-e.0.allow_charging" }), true);
		assert.equal(hasLegacyWallboxWriteMapping({ wb_set_current_a_target: "go-e.0.amperePV" }), true);
	});

	it("legacy config keys load without error", () => {
		const legacy = {
			wb_set_enabled_target: "go-e.0.allow_charging",
			wb_set_current_a_target: "go-e.0.amperePV",
			wb_set_charge_power_w_target: "go-e.0.amperePV",
			wb_set_phase_switch_target: "go-e.0.phaseSwitchModeEnabled",
			wb_vehicle_soc_target: "go-e.0.soc",
		};
		const cfg = wallboxEvccTelemetryConfigFromAdapter(legacy);
		assert.equal(cfg.vehicleSocStateId, "go-e.0.soc");
		const telemetryIds = configuredEvccTelemetryStateIds(cfg);
		assert.equal(telemetryIds.length, 1);
		assert.equal(hasLegacyWallboxWriteMapping(legacy), true);
	});
});
