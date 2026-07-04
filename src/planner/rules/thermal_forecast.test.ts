import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { immersionDeviceConfigFromAdapter } from "../../addons/immersion_heater/device_config.js";
import { resolveThermalForecastTarget } from "./thermal_forecast.js";

const BASE = immersionDeviceConfigFromAdapter({
	ih_set_enabled_target: "r",
	ih_planning_min_temp_c: 48,
	ih_planning_max_temp_c: 63,
	ih_forecast_mode_enabled: true,
});

function target(overrides: Partial<Parameters<typeof resolveThermalForecastTarget>[0]> = {}) {
	return resolveThermalForecastTarget({
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

describe("thermal forecast target", () => {
	it("uses max when forecast mode disabled", () => {
		const r = target({ forecastModeEnabled: false });
		assert.equal(r.targetTempC, 63);
		assert.equal(r.forecastActive, false);
	});

	it("uses max when KI optimization allowed", () => {
		const r = target({ aiOptimizationAllowed: true });
		assert.equal(r.targetTempC, 63);
		assert.equal(r.forecastActive, false);
	});

	it("targets min when buffer below planning min", () => {
		const r = target({ bufferTempC: 46 });
		assert.equal(r.targetTempC, 48);
		assert.match(r.targetReasonDe, /Mindeststand/);
	});

	it("targets max when tomorrow pv much lower", () => {
		const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 8 });
		assert.equal(r.targetTempC, 63);
	});

	it("targets moderate when tomorrow pv similar", () => {
		const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 18 });
		assert.equal(r.targetTempC, 54);
	});

	it("targets default fraction in middle case", () => {
		const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 12 });
		assert.equal(r.targetTempC, 58.5);
	});

	it("conservative target without forecast data", () => {
		const r = target({ pvTodayKwh: null, pvTomorrowKwh: null, pvBiasStatus: "no_data" });
		assert.equal(r.targetTempC, 61);
	});
});
