"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const index_js_1 = require("./index.js");
(0, node_test_1.describe)("battery consumers policy", () => {
    (0, node_test_1.it)("defaults: no consumer may use battery", () => {
        const cfg = (0, index_js_1.batteryConsumersConfigFromAdapter)({});
        strict_1.default.equal(cfg.immersion_heater.mayUseBattery, false);
        strict_1.default.equal(cfg.immersion_heater.onlyWhenCritical, true);
        strict_1.default.equal(cfg.immersion_heater.minSocPct, 50);
        strict_1.default.equal(cfg.air_conditioning.mayUseBattery, false);
        strict_1.default.equal(cfg.wallbox.mayUseBattery, false);
    });
    (0, node_test_1.it)("blocks on hold even when policy allows", () => {
        const r = (0, index_js_1.resolveBatteryConsumerAccess)({
            consumerId: "immersion_heater",
            rule: { mayUseBattery: true, onlyWhenCritical: false, minSocPct: 50, criticalMarginK: 2 },
            batteryHoldActive: true,
            socPct: 80,
            criticalNow: true,
        });
        strict_1.default.equal(r.allowed, false);
        strict_1.default.match(r.reasonDe, /Hold/);
    });
    (0, node_test_1.it)("blocks at SOC floor", () => {
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
    (0, node_test_1.it)("only-critical requires criticalNow", () => {
        const idle = (0, index_js_1.resolveBatteryConsumerAccess)({
            consumerId: "immersion_heater",
            rule: { mayUseBattery: true, onlyWhenCritical: true, minSocPct: 40, criticalMarginK: 2 },
            batteryHoldActive: false,
            socPct: 70,
            criticalNow: false,
        });
        strict_1.default.equal(idle.allowed, false);
        const crit = (0, index_js_1.resolveBatteryConsumerAccess)({
            consumerId: "immersion_heater",
            rule: { mayUseBattery: true, onlyWhenCritical: true, minSocPct: 40, criticalMarginK: 2 },
            batteryHoldActive: false,
            socPct: 70,
            criticalNow: true,
        });
        strict_1.default.equal(crit.allowed, true);
    });
    (0, node_test_1.it)("immersionCriticalNow uses margin", () => {
        strict_1.default.equal((0, index_js_1.immersionCriticalNow)(42, 40, 2), true);
        strict_1.default.equal((0, index_js_1.immersionCriticalNow)(43, 40, 2), false);
        strict_1.default.equal((0, index_js_1.immersionCriticalNow)(null, 40, 2), null);
    });
});
