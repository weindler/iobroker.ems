"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_js_1 = require("../config.js");
const mapping_js_1 = require("../mapping.js");
const registry_js_1 = require("../profiles/registry.js");
const validation_js_1 = require("./validation.js");
const CFG = {
    battery_profile: "sonnen_em",
    bat_hw_max_charge_w: 5000,
    bat_hw_max_discharge_w: 5000,
    bat_hw_min_soc_pct: 5,
    bat_hw_max_soc_pct: 95,
    bat_soc_target: "x.soc",
    bat_power_target: "x.power",
    bat_operating_mode_target: "x.mode",
    bat_battery_charging_target: "x.charge",
};
const config = (0, config_js_1.batteryConfigFromAdapter)(CFG);
const mapping = (0, mapping_js_1.batteryMappingFromConfig)(CFG);
const profile = (0, registry_js_1.getBatteryProfile)("sonnen_em");
const capabilities = profile.buildCapabilities({ config, mapping, limits: config.limits });
function intent(over) {
    return {
        requestId: "r1",
        action: "charge",
        targetSocPct: null,
        maxChargeW: 3000,
        maxDischargeW: null,
        energySource: "any",
        validFrom: null,
        validUntil: null,
        issuedAt: null,
        reason: "",
        source: "test",
        ...over,
    };
}
const base = {
    limits: config.limits,
    capabilities,
    governanceEnabled: true,
    telemetrySocValid: true,
    telemetryFreshForAction: true,
    fault: false,
    lockout: false,
};
(0, node_test_1.describe)("battery intent validation", () => {
    (0, node_test_1.it)("clamps charge power to hardware max", () => {
        const r = (0, validation_js_1.validateBatteryIntent)({ ...base, intent: intent({ maxChargeW: 9000 }) });
        strict_1.default.equal(r.accepted, true);
        strict_1.default.equal(r.effectiveChargeW, 5000);
        strict_1.default.ok(r.clamps.some((c) => c.reason === "hardware_max_charge_w"));
    });
    (0, node_test_1.it)("clamps target soc to hardware max", () => {
        const r = (0, validation_js_1.validateBatteryIntent)({ ...base, intent: intent({ targetSocPct: 100 }) });
        strict_1.default.equal(r.effectiveTargetSocPct, 95);
        strict_1.default.ok(r.clamps.some((c) => c.reason === "hardware_max_soc_pct"));
    });
    (0, node_test_1.it)("rejects when governance disabled", () => {
        const r = (0, validation_js_1.validateBatteryIntent)({ ...base, governanceEnabled: false, intent: intent({}) });
        strict_1.default.equal(r.accepted, false);
        strict_1.default.equal(r.rejectCode, "addon_disabled");
    });
    (0, node_test_1.it)("rejects charge when telemetry stale", () => {
        const r = (0, validation_js_1.validateBatteryIntent)({ ...base, telemetryFreshForAction: false, intent: intent({}) });
        strict_1.default.equal(r.accepted, false);
        strict_1.default.equal(r.rejectCode, "telemetry_stale");
    });
    (0, node_test_1.it)("rejects when limits invalid", () => {
        const badCfg = (0, config_js_1.batteryConfigFromAdapter)({ ...CFG, bat_hw_max_charge_w: 0 });
        const r = (0, validation_js_1.validateBatteryIntent)({ ...base, limits: badCfg.limits, intent: intent({}) });
        strict_1.default.equal(r.accepted, false);
    });
    (0, node_test_1.it)("rejects fault and lockout", () => {
        strict_1.default.equal((0, validation_js_1.validateBatteryIntent)({ ...base, fault: true, intent: intent({}) }).rejectCode, "fault");
        strict_1.default.equal((0, validation_js_1.validateBatteryIntent)({ ...base, lockout: true, intent: intent({}) }).rejectCode, "lockout");
    });
});
