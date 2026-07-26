import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { plannerModePolicyFromGlobalMode } from "../../../planner/mode_policy";
import { planBatteryChargeLogic } from "./battery_charge_logic";
import type { BatteryChargeLogicConfig, BatteryChargeLogicDayInput } from "./battery_charge_logic";

const NOW = new Date("2026-01-15T18:00:00Z");

function cfg(overrides: Partial<BatteryChargeLogicConfig> = {}): BatteryChargeLogicConfig {
	return {
		enabled: true,
		horizonDays: 7,
		marginKwh: 0.5,
		pvRecoveryRatio: 1.15,
		reserveLowConfidenceFactor: 0.25,
		maxSocPct: 100,
		minSocPct: 5,
		capacityKwh: 10,
		...overrides,
	};
}

function days(overrides: Partial<BatteryChargeLogicDayInput>[] = []): BatteryChargeLogicDayInput[] {
	const base: BatteryChargeLogicDayInput[] = [
		{ dayIndex: 0, dateKey: "2026-01-15", pvKwh: 1, loadKwh: 18, pvConfidencePct: 80 },
		{ dayIndex: 1, dateKey: "2026-01-16", pvKwh: 2, loadKwh: 20, pvConfidencePct: 75 },
		{ dayIndex: 2, dateKey: "2026-01-17", pvKwh: 3, loadKwh: 19, pvConfidencePct: 60 },
		{ dayIndex: 3, dateKey: "2026-01-18", pvKwh: 25, loadKwh: 18, pvConfidencePct: 55 },
		{ dayIndex: 4, dateKey: "2026-01-19", pvKwh: 10, loadKwh: 17, pvConfidencePct: 50 },
		{ dayIndex: 5, dateKey: "2026-01-20", pvKwh: 12, loadKwh: 16, pvConfidencePct: 45 },
		{ dayIndex: 6, dateKey: "2026-01-21", pvKwh: 14, loadKwh: 15, pvConfidencePct: 40 },
	];
	return base.map((d, i) => ({ ...d, ...(overrides[i] ?? {}) }));
}

describe("battery charge logic (PV-Defizit, Block 2)", () => {
	it("requests grid charge when the PV horizon cannot cover the load", () => {
		const r = planBatteryChargeLogic({
			now: NOW,
			socPct: 55,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: true,
			days: days(),
		});
		assert.equal(r.forecastActive, true);
		assert.ok(r.chargeEnergyKwh !== null && r.chargeEnergyKwh > 0);
		assert.ok(r.socTargetPct !== null && r.socTargetPct > 55);
		assert.equal(r.pvRecoveryDay, 4);
		assert.ok(r.bridgeUntilIso !== null);
		assert.doesNotMatch(r.reasonDe, /Winter/i);
	});

	it("this can also trigger in summer given several bad-weather days — no season gate", () => {
		const summerNow = new Date("2026-07-10T18:00:00Z");
		const r = planBatteryChargeLogic({
			now: summerNow,
			socPct: 55,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: true,
			days: days(),
		});
		assert.equal(r.active, true);
		assert.ok(r.chargeEnergyKwh !== null && r.chargeEnergyKwh > 0);
	});

	it("no grid charge when stored energy covers the bridge", () => {
		const sunny = days().map((d) => ({ ...d, pvKwh: 20, loadKwh: 10 }));
		const r = planBatteryChargeLogic({
			now: NOW,
			socPct: 95,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: true,
			days: sunny,
		});
		assert.equal(r.active, false);
		assert.equal(r.chargeEnergyKwh, null);
	});

	it("comfort adds more reserve than eco", () => {
		const base = {
			now: NOW,
			socPct: 50,
			snowCoverSuspected: false,
			config: cfg(),
			governanceEnabled: true,
			days: days(),
		};
		const eco = planBatteryChargeLogic({ ...base, modePolicy: plannerModePolicyFromGlobalMode("eco") });
		const comfort = planBatteryChargeLogic({ ...base, modePolicy: plannerModePolicyFromGlobalMode("comfort") });
		assert.ok((comfort.chargeEnergyKwh ?? 0) >= (eco.chargeEnergyKwh ?? 0));
	});

	it("disabled config pauses the logic", () => {
		const r = planBatteryChargeLogic({
			now: NOW,
			socPct: 50,
			snowCoverSuspected: false,
			config: cfg({ enabled: false }),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: true,
			days: days(),
		});
		assert.equal(r.forecastActive, false);
		assert.equal(r.active, false);
	});

	it("governance off pauses the logic", () => {
		const r = planBatteryChargeLogic({
			now: NOW,
			socPct: 50,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: false,
			days: days(),
		});
		assert.equal(r.active, false);
	});

	it("global mode off pauses the logic", () => {
		const r = planBatteryChargeLogic({
			now: NOW,
			socPct: 50,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("off"),
			governanceEnabled: true,
			days: days(),
		});
		assert.equal(r.active, false);
	});

	it("missing capacity pauses the logic", () => {
		const r = planBatteryChargeLogic({
			now: NOW,
			socPct: 50,
			snowCoverSuspected: false,
			config: cfg({ capacityKwh: null }),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: true,
			days: days(),
		});
		assert.equal(r.active, false);
	});

	it("missing SOC pauses the logic", () => {
		const r = planBatteryChargeLogic({
			now: NOW,
			socPct: null,
			snowCoverSuspected: false,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: true,
			days: days(),
		});
		assert.equal(r.active, false);
	});

	it("snow cover adds an extra margin on top of an existing deficit, but is not the sole trigger", () => {
		const base = {
			now: NOW,
			socPct: 55,
			config: cfg(),
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			governanceEnabled: true,
			days: days(),
		};
		const withoutSnow = planBatteryChargeLogic({ ...base, snowCoverSuspected: false });
		const withSnow = planBatteryChargeLogic({ ...base, snowCoverSuspected: true });
		assert.ok((withSnow.energyDeficitKwh ?? 0) > (withoutSnow.energyDeficitKwh ?? 0));

		const sunny = days().map((d) => ({ ...d, pvKwh: 20, loadKwh: 10 }));
		const sunnyWithSnow = planBatteryChargeLogic({ ...base, days: sunny, snowCoverSuspected: true });
		assert.equal(sunnyWithSnow.active, false);
	});
});
