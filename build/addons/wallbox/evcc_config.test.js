"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const strict_1 = __importDefault(require("node:assert/strict"));
const node_test_1 = require("node:test");
const evcc_config_1 = require("./evcc_config");
(0, node_test_1.describe)("wallbox evcc_config", () => {
    (0, node_test_1.it)("parses wb_evcc telemetry state ids", () => {
        const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)({
            wb_evcc_connected_state: "evcc.0.status.connected",
            wb_evcc_charging_state: "evcc.0.status.charging",
            wb_evcc_charge_power_w_state: "evcc.0.status.chargePower",
        });
        strict_1.default.equal(cfg.connectedStateId, "evcc.0.status.connected");
        strict_1.default.equal(cfg.chargingStateId, "evcc.0.status.charging");
        strict_1.default.equal(cfg.chargePowerWStateId, "evcc.0.status.chargePower");
        strict_1.default.deepEqual((0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg), [
            "evcc.0.status.connected",
            "evcc.0.status.charging",
            "evcc.0.status.chargePower",
        ]);
    });
    (0, node_test_1.it)("falls back to legacy wb_vehicle_soc_target for vehicle soc", () => {
        const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)({
            wb_vehicle_soc_target: "evcc.0.status.vehicleSoc",
        });
        strict_1.default.equal(cfg.vehicleSocStateId, "evcc.0.status.vehicleSoc");
    });
    (0, node_test_1.it)("prefers wb_evcc_vehicle_soc over legacy", () => {
        const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)({
            wb_evcc_vehicle_soc_state: "evcc.0.status.vehicleSoc",
            wb_vehicle_soc_target: "go-e.0.soc",
        });
        strict_1.default.equal(cfg.vehicleSocStateId, "evcc.0.status.vehicleSoc");
    });
    (0, node_test_1.it)("builds mapping entries for configured telemetry", () => {
        const m = (0, evcc_config_1.wallboxEvccTelemetryMappingFromConfig)({
            wb_evcc_enabled_state: "evcc.0.status.enabled",
        });
        strict_1.default.deepEqual(m.evcc_enabled, { enabled: true, target_state: "evcc.0.status.enabled" });
    });
    (0, node_test_1.it)("detects legacy go-e write mappings", () => {
        strict_1.default.equal((0, evcc_config_1.hasLegacyWallboxWriteMapping)({}), false);
        strict_1.default.equal((0, evcc_config_1.hasLegacyWallboxWriteMapping)({ wb_set_enabled_target: "go-e.0.allow_charging" }), true);
        strict_1.default.equal((0, evcc_config_1.hasLegacyWallboxWriteMapping)({ wb_set_current_a_target: "go-e.0.amperePV" }), true);
    });
    (0, node_test_1.it)("legacy config keys load without error", () => {
        const legacy = {
            wb_set_enabled_target: "go-e.0.allow_charging",
            wb_set_current_a_target: "go-e.0.amperePV",
            wb_set_charge_power_w_target: "go-e.0.amperePV",
            wb_set_phase_switch_target: "go-e.0.phaseSwitchModeEnabled",
            wb_vehicle_soc_target: "go-e.0.soc",
        };
        const cfg = (0, evcc_config_1.wallboxEvccTelemetryConfigFromAdapter)(legacy);
        strict_1.default.equal(cfg.vehicleSocStateId, "go-e.0.soc");
        const telemetryIds = (0, evcc_config_1.configuredEvccTelemetryStateIds)(cfg);
        strict_1.default.equal(telemetryIds.length, 1);
        strict_1.default.equal((0, evcc_config_1.hasLegacyWallboxWriteMapping)(legacy), true);
    });
});
