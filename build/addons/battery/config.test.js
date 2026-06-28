"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const config_js_1 = require("./config.js");
(0, node_test_1.describe)("battery config", () => {
    (0, node_test_1.it)("maps legacy 'sonnen' profile to sonnen_em", () => {
        strict_1.default.equal((0, config_js_1.batteryProfileIdFromConfig)({ battery_profile: "sonnen" }), "sonnen_em");
        strict_1.default.equal((0, config_js_1.batteryProfileIdFromConfig)({ battery_profile: "sonnen_em" }), "sonnen_em");
        strict_1.default.equal((0, config_js_1.batteryProfileIdFromConfig)({ battery_profile: "generic_readonly" }), "generic_readonly");
    });
    (0, node_test_1.it)("manual capacity parsed", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({ battery_capacity_source: "manual", battery_capacity_net_kwh: 10 });
        strict_1.default.equal(c.capacitySource, "manual");
        strict_1.default.equal(c.capacityManualKwh, 10);
    });
    (0, node_test_1.it)("sign convention defaults to positive_charge", () => {
        strict_1.default.equal((0, config_js_1.batteryConfigFromAdapter)({}).signConvention, "positive_charge");
        strict_1.default.equal((0, config_js_1.batteryConfigFromAdapter)({ battery_power_sign_convention: "positive_discharge" }).signConvention, "positive_discharge");
    });
    (0, node_test_1.it)("sonnen mode value defaults manual=1 self=2", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({});
        strict_1.default.equal(c.sonnenModeValues.manual, 1);
        strict_1.default.equal(c.sonnenModeValues.selfConsumption, 2);
    });
    (0, node_test_1.it)("grid balance defaults", () => {
        const c = (0, config_js_1.batteryConfigFromAdapter)({});
        strict_1.default.equal(c.gridBalance.enabled, false);
        strict_1.default.equal(c.gridBalance.offsetHighSocW, 25);
    });
});
