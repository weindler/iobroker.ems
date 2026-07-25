import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { plannerModePolicyFromGlobalMode } from "../mode_policy.js";
import { dailyKwhFromHouseLoadForecast, planBatteryWinter } from "./battery_winter.js";
import type { BatteryWinterPlanConfig } from "../battery_winter_config.js";
import type { BatteryWinterDayInput } from "./battery_winter.js";
import { MS_PER_15MIN } from "../../learning/price_forecast/tibber_parse.js";

const NOW = new Date("2026-01-15T18:00:00Z");

function cfg(overrides: Partial<BatteryWinterPlanConfig> = {}): BatteryWinterPlanConfig {
	return {
		enabled: true,
		horizonDays: 7,
		marginKwh: 0.5,
		chargeEfficiencyPct: 92,
		pvRecoveryRatio: 1.15,
		reserveLowConfidenceFactor: 0.25,
		maxChargeW: 4200,
		maxSocPct: 100,
		minSocPct: 5,
		capacityKwh: 10,
		...overrides,
	};
}

function winterDays(overrides: Partial<BatteryWinterDayInput>[] = []): BatteryWinterDayInput[] {
	const base: BatteryWinterDayInput[] = [
		{ dayIndex: 1, dateKey: "2026-01-15", pvKwh: 1, loadKwh: 18, pvConfidencePct: 80 },
		{ dayIndex: 2, dateKey: "2026-01-16", pvKwh: 2, loadKwh: 20, pvConfidencePct: 75 },
		{ dayIndex: 3, dateKey: "2026-01-17", pvKwh: 3, loadKwh: 19, pvConfidencePct: 60 },
		{ dayIndex: 4, dateKey: "2026-01-18", pvKwh: 25, loadKwh: 18, pvConfidencePct: 55 },
		{ dayIndex: 5, dateKey: "2026-01-19", pvKwh: 10, loadKwh: 17, pvConfidencePct: 50 },
		{ dayIndex: 6, dateKey: "2026-01-20", pvKwh: 12, loadKwh: 16, pvConfidencePct: 45 },
		{ dayIndex: 7, dateKey: "2026-01-21", pvKwh: 14, loadKwh: 15, pvConfidencePct: 40 },
	];
	return base.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}

describe("battery winter plan", () => {
	it("requests grid charge when PV horizon cannot cover load", () => {
		const r = planBatteryWinter({
			now: NOW,
			socPct: 55,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			batteryGovernanceEnabled: true,
			batteryAiAllowed: false,
			days: winterDays(),
			priceSlots: [],
		});
		assert.equal(r.forecast_active, true);
		assert.ok(r.charge_energy_kwh !== null && r.charge_energy_kwh > 0);
		assert.ok(r.soc_target_pct !== null && r.soc_target_pct > 55);
		assert.ok(r.charge_slots_15m !== null && r.charge_slots_15m > 0);
		assert.equal(r.pv_recovery_day, 4);
	});

	it("no grid charge when stored energy covers bridge", () => {
		const sunny = winterDays().map((d) => ({ ...d, pvKwh: 20, loadKwh: 10 }));
		const r = planBatteryWinter({
			now: NOW,
			socPct: 95,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			batteryGovernanceEnabled: true,
			batteryAiAllowed: false,
			days: sunny,
			priceSlots: [],
		});
		assert.equal(r.active, false);
		assert.equal(r.charge_energy_kwh, null);
	});

	it("comfort adds more reserve than eco", () => {
		const base = {
			now: NOW,
			socPct: 50,
			snowCoverSuspected: false,
			config: cfg(),
			batteryGovernanceEnabled: true,
			batteryAiAllowed: false,
			days: winterDays(),
			priceSlots: [],
		};
		const eco = planBatteryWinter({ ...base, modePolicy: plannerModePolicyFromGlobalMode("eco") });
		const comfort = planBatteryWinter({ ...base, modePolicy: plannerModePolicyFromGlobalMode("comfort") });
		assert.ok((comfort.charge_energy_kwh ?? 0) >= (eco.charge_energy_kwh ?? 0));
	});

	it("batteryAiAllowed does not override the regelbasierte Winter-Netzplanung", () => {
		const base = {
			now: NOW,
			socPct: 50,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			batteryGovernanceEnabled: true,
			days: winterDays(),
			priceSlots: [],
		};
		const withAi = planBatteryWinter({ ...base, batteryAiAllowed: true });
		const withoutAi = planBatteryWinter({ ...base, batteryAiAllowed: false });
		assert.deepEqual(withAi, withoutAi);
		assert.equal(withAi.forecast_active, true);
	});

	it("sums house load segments to daily kWh", () => {
		const kwh = dailyKwhFromHouseLoadForecast({
			date: "2026-01-15",
			season: "winter",
			weekday: "thursday",
			day_type: "weekday",
			segments: {
				night: { avg_w: 500, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
				morning: { avg_w: 1000, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
				midday: { avg_w: 800, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
				afternoon: { avg_w: 900, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
				evening: { avg_w: 1200, source: "t", fallback_level: "season_weekday_segment", confidence: 0.8 },
			},
		});
		assert.equal(kwh, 21);
	});

	it("selects Tibber windows when price slots are available", () => {
		const baseMs = NOW.getTime();
		const priceSlots = Array.from({ length: 8 }, (_, i) => ({
			slotStartMs: baseMs + i * MS_PER_15MIN,
			priceCtPerKwh: i === 2 || i === 3 ? 10 : 40 - i,
		}));
		const r = planBatteryWinter({
			now: NOW,
			socPct: 55,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			batteryGovernanceEnabled: true,
			batteryAiAllowed: false,
			days: winterDays(),
			priceSlots,
		});
		assert.ok(r.windows.length > 0);
		assert.match(r.reason_de, /Preisfenster/);
	});
});
