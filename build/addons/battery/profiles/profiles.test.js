"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_js_1 = require("../config.js");
const mapping_js_1 = require("../mapping.js");
const registry_js_1 = require("./registry.js");
const FULL_SONNEN = {
    battery_profile: "sonnen_em",
    bat_hw_max_charge_w: 5000,
    bat_hw_max_discharge_w: 5000,
    bat_hw_min_soc_pct: 5,
    bat_hw_max_soc_pct: 100,
    bat_soc_target: "sonnen.0.status.soc",
    bat_power_target: "sonnen.0.status.power",
    bat_operating_mode_target: "sonnen.0.configurations.EM_OperatingMode",
    bat_battery_charging_target: "sonnen.0.control.charge",
};
(0, node_test_1.describe)("generic_readonly profile", () => {
    const profile = (0, registry_js_1.getBatteryProfile)("generic_readonly");
    const config = (0, config_js_1.batteryConfigFromAdapter)({ battery_profile: "generic_readonly", bat_soc_target: "x.soc" });
    const mapping = (0, mapping_js_1.batteryMappingFromConfig)({ battery_profile: "generic_readonly", bat_soc_target: "x.soc" });
    const input = { config, mapping, limits: config.limits };
    (0, node_test_1.it)("reads telemetry, no control / live", () => {
        const caps = profile.buildCapabilities(input);
        strict_1.default.equal(caps.read_soc.available, true);
        strict_1.default.equal(caps.set_charge_power.available, false);
        strict_1.default.equal(caps.set_operating_mode.available, false);
        strict_1.default.equal(caps.live_control.available, false);
        strict_1.default.equal(profile.supportsLive, false);
    });
    (0, node_test_1.it)("never live-ready", () => {
        const r = profile.computeReadiness(input);
        strict_1.default.equal(r.liveReady, false);
        strict_1.default.equal(r.controlReady, false);
    });
});
(0, node_test_1.describe)("sonnen_em profile", () => {
    const profile = (0, registry_js_1.getBatteryProfile)("sonnen_em");
    const config = (0, config_js_1.batteryConfigFromAdapter)(FULL_SONNEN);
    const mapping = (0, mapping_js_1.batteryMappingFromConfig)(FULL_SONNEN);
    const input = { config, mapping, limits: config.limits };
    (0, node_test_1.it)("normalizes sonnen mode numbers", () => {
        strict_1.default.equal(profile.normalizeOperatingMode(1, input), "manual");
        strict_1.default.equal(profile.normalizeOperatingMode(2, input), "self_consumption");
        strict_1.default.equal(profile.normalizeOperatingMode(7, input), "unknown");
    });
    (0, node_test_1.it)("capability matrix correct for full config", () => {
        const caps = profile.buildCapabilities(input);
        strict_1.default.equal(caps.set_operating_mode.available, true);
        strict_1.default.equal(caps.set_charge_power.available, true);
        strict_1.default.equal(caps.live_control.available, true);
        strict_1.default.equal(caps.safe_restore.available, true);
    });
    (0, node_test_1.it)("discharge not supported", () => {
        const caps = profile.buildCapabilities(input);
        strict_1.default.equal(caps.set_discharge_power.supported, false);
        strict_1.default.equal(caps.set_discharge_power.available, false);
    });
    (0, node_test_1.it)("missing write mapping prevents live readiness", () => {
        const cfgNoWrite = { ...FULL_SONNEN, bat_battery_charging_target: "" };
        const m = (0, mapping_js_1.batteryMappingFromConfig)(cfgNoWrite);
        const c = (0, config_js_1.batteryConfigFromAdapter)(cfgNoWrite);
        const r = profile.computeReadiness({ config: c, mapping: m, limits: c.limits });
        strict_1.default.equal(r.liveReady, false);
        strict_1.default.equal(r.telemetryReady, true);
    });
});
