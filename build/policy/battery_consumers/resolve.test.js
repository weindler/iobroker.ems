"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
(0, node_test_1.describe)("battery consumers policy", () => {
    (0, node_test_1.it)("defaults to automatic support without fixed per-consumer SOC floors", () => {
        const cfg = (0, index_js_1.batteryConsumersConfigFromAdapter)({});
        for (const id of ["immersion_heater", "air_conditioning", "wallbox"]) {
            strict_1.default.equal(cfg[id].mayUseBattery, true);
            strict_1.default.equal(cfg[id].onlyWhenCritical, false);
            strict_1.default.equal(cfg[id].minSocPct, null);
        }
        strict_1.default.equal(cfg.maxDischargePowerW, null);
    });
    (0, node_test_1.it)("one automatic-support switch controls all flexible consumers", () => {
        const cfg = (0, index_js_1.batteryConsumersConfigFromAdapter)({ bat_consumer_auto_support: false });
        strict_1.default.equal(cfg.immersion_heater.mayUseBattery, false);
        strict_1.default.equal(cfg.air_conditioning.mayUseBattery, false);
        strict_1.default.equal(cfg.wallbox.mayUseBattery, false);
    });
    (0, node_test_1.it)("ignores legacy per-consumer switches, SOC floors and power budget", () => {
        const cfg = (0, index_js_1.batteryConsumersConfigFromAdapter)({
            bat_consumer_auto_support: true,
            bat_consumer_immersion_may_use_battery: false,
            bat_consumer_immersion_only_when_critical: true,
            bat_consumer_immersion_min_soc_pct: 99,
            bat_consumer_max_discharge_w: 1,
        });
        strict_1.default.equal(cfg.immersion_heater.mayUseBattery, true);
        strict_1.default.equal(cfg.immersion_heater.onlyWhenCritical, false);
        strict_1.default.equal(cfg.immersion_heater.minSocPct, null);
        strict_1.default.equal(cfg.maxDischargePowerW, null);
    });
    (0, node_test_1.it)("blocks on hold even when automatic support is enabled", () => {
        const r = (0, index_js_1.resolveBatteryConsumerAccess)({
            consumerId: "immersion_heater",
            rule: { mayUseBattery: true, onlyWhenCritical: false, minSocPct: null, criticalMarginK: 2 },
            batteryHoldActive: true,
            socPct: 80,
            criticalNow: true,
        });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.match(r.reasonDe, /Hold/);
    });
    (0, node_test_1.it)("generic access still honours an explicit safety floor", () => {
        const r = (0, index_js_1.resolveBatteryConsumerAccess)({
            consumerId: "immersion_heater",
            rule: { mayUseBattery: true, onlyWhenCritical: false, minSocPct: 50, criticalMarginK: 2 },
            batteryHoldActive: false,
            socPct: 50,
            criticalNow: true,
        });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.match(r.reasonDe, /Boden/);
    });
    (0, node_test_1.it)("immersionCriticalNow keeps the thermal emergency classification", () => {
        strict_1.default.equal((0, index_js_1.immersionCriticalNow)(42, 40, 2), true);
        strict_1.default.equal((0, index_js_1.immersionCriticalNow)(43, 40, 2), false);
        strict_1.default.equal((0, index_js_1.immersionCriticalNow)(null, 40, 2), null);
    });
});
