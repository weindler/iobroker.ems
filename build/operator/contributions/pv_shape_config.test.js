"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const pv_shape_config_1 = require("./pv_shape_config");
(0, node_test_1.describe)("pvShapeConfigFromAdapter", () => {
    (0, node_test_1.it)("defaults to disabled with empty mappings", () => {
        const cfg = (0, pv_shape_config_1.pvShapeConfigFromAdapter)({});
        strict_1.default.equal(cfg.enabled, false);
        strict_1.default.equal(cfg.brightskyHourlyPrefix, "");
        strict_1.default.equal(cfg.kwpState1, "");
        strict_1.default.equal(cfg.kwpState2, "");
    });
    (0, node_test_1.it)("reads configured values and trims strings", () => {
        const cfg = (0, pv_shape_config_1.pvShapeConfigFromAdapter)({
            pv_shape_enabled: true,
            pv_shape_brightsky_hourly_prefix: " brightsky.0.hourly ",
            pv_shape_kwp_state_1: "pvforecast.0.plants.pvNordWest.power.installed",
            pv_shape_kwp_state_2: "",
        });
        strict_1.default.equal(cfg.enabled, true);
        strict_1.default.equal(cfg.brightskyHourlyPrefix, "brightsky.0.hourly");
        strict_1.default.equal(cfg.kwpState1, "pvforecast.0.plants.pvNordWest.power.installed");
        strict_1.default.equal(cfg.kwpState2, "");
    });
    (0, node_test_1.it)("tolerates non-object config", () => {
        const cfg = (0, pv_shape_config_1.pvShapeConfigFromAdapter)(null);
        strict_1.default.equal(cfg.enabled, false);
    });
});
(0, node_test_1.describe)("pvShapeConfigReady", () => {
    (0, node_test_1.it)("requires enabled AND a configured hourly prefix", () => {
        strict_1.default.equal((0, pv_shape_config_1.pvShapeConfigReady)({ enabled: false, brightskyHourlyPrefix: "brightsky.0.hourly", kwpState1: "", kwpState2: "" }), false);
        strict_1.default.equal((0, pv_shape_config_1.pvShapeConfigReady)({ enabled: true, brightskyHourlyPrefix: "", kwpState1: "", kwpState2: "" }), false);
        strict_1.default.equal((0, pv_shape_config_1.pvShapeConfigReady)({ enabled: true, brightskyHourlyPrefix: "brightsky.0.hourly", kwpState1: "", kwpState2: "" }), true);
    });
});
