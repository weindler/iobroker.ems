"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const device_config_js_1 = require("../../addons/immersion_heater/device_config.js");
const thermal_forecast_js_1 = require("./thermal_forecast.js");
const BASE = (0, device_config_js_1.immersionDeviceConfigFromAdapter)({
    ih_set_enabled_target: "r",
    ih_planning_min_temp_c: 48,
    ih_planning_max_temp_c: 63,
    ih_forecast_mode_enabled: true,
});
function target(overrides = {}) {
    return (0, thermal_forecast_js_1.resolveThermalForecastTarget)({
        config: BASE,
        bufferTempC: 55,
        pvTodayKwh: 20,
        pvTomorrowKwh: 10,
        pvBiasStatus: "ready",
        forecastModeEnabled: true,
        aiOptimizationAllowed: false,
        ...overrides,
    });
}
(0, node_test_1.describe)("thermal forecast target", () => {
    (0, node_test_1.it)("uses max when forecast mode disabled", () => {
        const r = target({ forecastModeEnabled: false });
        strict_1.default.equal(r.targetTempC, 63);
        strict_1.default.equal(r.forecastActive, false);
    });
    (0, node_test_1.it)("aiOptimizationAllowed does not override the regelbasierten PV-Forecast", () => {
        const withAi = target({ aiOptimizationAllowed: true });
        const withoutAi = target({ aiOptimizationAllowed: false });
        strict_1.default.deepEqual(withAi, withoutAi);
        strict_1.default.equal(withAi.forecastActive, true);
    });
    (0, node_test_1.it)("targets min when buffer below planning min", () => {
        const r = target({ bufferTempC: 46 });
        strict_1.default.equal(r.targetTempC, 48);
        strict_1.default.match(r.targetReasonDe, /Mindeststand/);
    });
    (0, node_test_1.it)("targets max when tomorrow pv much lower", () => {
        const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 8 });
        strict_1.default.equal(r.targetTempC, 63);
    });
    (0, node_test_1.it)("targets moderate when tomorrow pv similar", () => {
        const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 18 });
        strict_1.default.equal(r.targetTempC, 54);
    });
    (0, node_test_1.it)("targets default fraction in middle case", () => {
        const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 12 });
        strict_1.default.equal(r.targetTempC, 58.5);
    });
    (0, node_test_1.it)("conservative target without forecast data", () => {
        const r = target({ pvTodayKwh: null, pvTomorrowKwh: null, pvBiasStatus: "no_data" });
        strict_1.default.equal(r.targetTempC, 61);
    });
});
