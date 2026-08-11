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

describe("thermal forecast target — Soft Puffer", () => {
	it("uses max when forecast mode disabled", () => {
		const r = target({ forecastModeEnabled: false });
		assert.equal(r.targetTempC, 63);
		assert.equal(r.forecastActive, false);
	});

	it("aiOptimizationAllowed does not override the regelbasierten PV-Forecast", () => {
		const withAi = target({ aiOptimizationAllowed: true });
		const withoutAi = target({ aiOptimizationAllowed: false });
		assert.deepEqual(withAi, withoutAi);
		assert.equal(withAi.forecastActive, true);
	});

	it("soft target stays between current buffer and max (no hard catch-up to planningMin)", () => {
		const r = target({ bufferTempC: 46, pvTodayKwh: 20, pvTomorrowKwh: 18 });
		assert.ok(r.targetTempC >= 46);
		assert.ok(r.targetTempC <= 63);
		assert.match(r.targetReasonDe, /Soft/i);
	});

	it("targets max when tomorrow pv much lower", () => {
		const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 8 });
		assert.equal(r.targetTempC, 63);
	});

	it("targets moderate soft span when tomorrow pv similar", () => {
		const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 18 });
		/** Floor = buffer 55, span 8, fraction 0.4 → 58.2 */
		assert.equal(r.targetTempC, 58.2);
	});

	it("targets default fraction soft span in middle case", () => {
		const r = target({ pvTodayKwh: 20, pvTomorrowKwh: 12 });
		/** Floor = 55, span 8, fraction 0.7 → 60.6 */
		assert.equal(r.targetTempC, 60.6);
	});

	it("conservative soft target without forecast data", () => {
		const r = target({ pvTodayKwh: null, pvTomorrowKwh: null, pvBiasStatus: "no_data" });
		assert.equal(r.targetTempC, 61);
	});
});
