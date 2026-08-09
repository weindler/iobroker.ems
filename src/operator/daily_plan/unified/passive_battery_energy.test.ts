import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolvePassiveBatteryEnergyAvailable } from "./passive_battery_energy.js";
import { allocateUnifiedDayPlan } from "./allocate.js";
import { buildSlots, golden001Input } from "./fixtures.js";
import { REASON } from "./reason_codes.js";
import type { UnifiedDayPlannerInput } from "./types.js";
import { operatorQuality } from "../../quality.js";

const TZ = "Europe/Berlin";
const Q = operatorQuality("valid", "ok", 80);
const FRESH = { observedAtIso: "2026-08-08T15:00:00.000Z", ageSec: 10, quality: Q };

function climateBatteryScenario(passiveAvailable: boolean): UnifiedDayPlannerInput {
	const nowIso = "2026-08-08T15:00:00.000Z";
	const slots = buildSlots(nowIso, 48);
	const input = golden001Input();
	input.globalMode = "comfort";
	input.time = {
		...input.time,
		nowIso,
		timezone: TZ,
		slots,
		horizonStartIso: slots[0]!.startIso,
		horizonEndIso: slots[slots.length - 1]!.endIso,
	};
	input.pv.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		const day0 = Date.parse(s.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
		let power = 0;
		if (day0 && h >= 15 && h < 17) power = 400;
		else if (!day0 && h >= 7 && h < 16) power = 4200;
		return {
			slot: s,
			forecastPowerW: power,
			observedPowerW: null,
			energyKwh: (power / 1000) * 0.25,
		};
	});
	input.pv.expectedDayEnergyKwh = 6;
	input.houseLoad.slots = slots.map((s) => ({
		slot: s,
		forecastPowerW: 700,
		observedPowerW: null,
		energyKwh: 0.175,
	}));
	input.battery = {
		...input.battery,
		socPct: 90,
		usableCapacityKwh: 10,
		minSocPct: 10,
		reserveSocPct: 10,
		nightReserveKwh: 2.5,
		endSocTargetPct: 40,
		requiredChargeEnergyKwh: 0,
		dischargeLiveSupported: false,
		passiveBatteryEnergyAvailable: passiveAvailable,
		uncertainty: Q,
		freshness: FRESH,
	};
	input.wallbox = null;
	input.thermal = { ...input.thermal!, headroomEnergyKwh: 0.2, deadlineIso: null };
	input.climate = {
		units: [
			{
				unitId: "air_conditioning.unit_1",
				label: "wohn",
				roomTempC: 28,
				comfortMinC: null,
				comfortMaxC: 26,
				targetTempC: 25.5,
				mandatoryComfort: true,
				expectedEnergyKwh: 2.5,
				typicalPowerW: 900,
				maxShiftHours: 0,
				uncertainty: Q,
			},
		],
		freshness: FRESH,
	};
	return input;
}

function sumClimateBattery(plan: ReturnType<typeof allocateUnifiedDayPlan>): number {
	return plan.allocations
		.filter((a) => a.kind === "climate" && (a.energySource === "battery" || a.energySource === "mixed"))
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

describe("passive battery energy availability", () => {
	it("self-consumption → available", () => {
		const d = resolvePassiveBatteryEnergyAvailable({
			operatingMode: 2,
			selfConsumptionModeValue: 2,
			manualModeValue: 1,
			ownershipActive: false,
		});
		assert.equal(d.available, true);
		assert.equal(d.reasonCode, "passive_battery_self_consumption");
	});

	it("manual/hold → unavailable", () => {
		const d = resolvePassiveBatteryEnergyAvailable({
			operatingMode: 1,
			selfConsumptionModeValue: 2,
			manualModeValue: 1,
			ownershipActive: false,
		});
		assert.equal(d.available, false);
		assert.equal(d.reasonCode, "passive_battery_manual");
	});

	it("unknown mode → conservative unavailable", () => {
		const d = resolvePassiveBatteryEnergyAvailable({
			operatingMode: null,
			selfConsumptionModeValue: 2,
			manualModeValue: 1,
			ownershipActive: false,
		});
		assert.equal(d.available, false);
		assert.equal(d.reasonCode, "passive_battery_mode_unknown");
	});

	it("ownership active → unavailable", () => {
		const d = resolvePassiveBatteryEnergyAvailable({
			operatingMode: 2,
			selfConsumptionModeValue: 2,
			manualModeValue: 1,
			ownershipActive: true,
		});
		assert.equal(d.available, false);
		assert.equal(d.reasonCode, "passive_battery_ownership");
	});

	it("battery hold → unavailable", () => {
		const d = resolvePassiveBatteryEnergyAvailable({
			operatingMode: 2,
			selfConsumptionModeValue: 2,
			manualModeValue: 1,
			ownershipActive: false,
			batteryHoldActive: true,
		});
		assert.equal(d.available, false);
		assert.equal(d.reasonCode, "passive_battery_hold");
	});
});

describe("passive battery energy — unified allocate gate", () => {
	it("Fall A: self-consumption allows battery energySource for climate", () => {
		const plan = allocateUnifiedDayPlan(climateBatteryScenario(true));
		assert.ok(plan.reasonCodes.includes(REASON.BATTERY_DISCHARGE_LIVE_UNSUPPORTED));
		assert.ok(!plan.reasonCodes.includes(REASON.BATTERY_PASSIVE_ENERGY_UNAVAILABLE));
		assert.ok(sumClimateBattery(plan) > 0.3, `expected climate from battery, got ${sumClimateBattery(plan)}`);
		assert.ok(!plan.allocations.some((a) => a.kind === "battery_discharge"));
	});

	it("Fall B: manual blocks battery energySource for live loads", () => {
		const plan = allocateUnifiedDayPlan(climateBatteryScenario(false));
		assert.ok(plan.reasonCodes.includes(REASON.BATTERY_PASSIVE_ENERGY_UNAVAILABLE));
		assert.equal(sumClimateBattery(plan), 0, "must not fund climate from unavailable passive battery");
		assert.ok(!plan.allocations.some((a) => a.kind === "battery_discharge"));
	});
});
