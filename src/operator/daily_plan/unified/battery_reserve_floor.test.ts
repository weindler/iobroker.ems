/**
 * Zeitabhängiger Battery-Reserve-Floor + usable energy (Befund 004 Ergänzung).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	buildBatteryReserveFloor,
	findPvRecoverySlotIdx,
	unavoidableNeedKwh,
	usableBatteryEnergyKwh,
} from "./battery_reserve_floor";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildSlots, golden001Input } from "./fixtures";
import { operatorQuality } from "../../quality";
import { REASON } from "./reason_codes";

const TZ = "Europe/Berlin";
const Q = operatorQuality("valid", "floor", 85);
const FRESH = { observedAtIso: "2026-08-08T14:00:00.000Z", ageSec: 10, quality: Q };

function sumKind(
	plan: ReturnType<typeof allocateUnifiedDayPlan>,
	kind: string,
	pred?: (a: (typeof plan.allocations)[0]) => boolean,
): number {
	return plan.allocations
		.filter((a) => a.kind === kind && (!pred || pred(a)))
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

describe("battery_reserve_floor unit", () => {
	it("afternoon holds full night reserve; night tapers; morning cushion", () => {
		const recoveryMs = Date.parse("2026-08-09T08:00:00.000Z");
		const afternoon = unavoidableNeedKwh({
			slotStartIso: "2026-08-08T12:00:00.000Z",
			slotMs: Date.parse("2026-08-08T12:00:00.000Z"),
			recoveryMs,
			nightReserveKwh: 2.5,
			timeZone: TZ,
		});
		assert.equal(afternoon, 2.5);
		const night = unavoidableNeedKwh({
			slotStartIso: "2026-08-08T23:00:00.000Z",
			slotMs: Date.parse("2026-08-08T23:00:00.000Z"),
			recoveryMs,
			nightReserveKwh: 2.5,
			timeZone: TZ,
		});
		assert.ok(night < 2.5 && night > 1.0, `night taper got ${night}`);
		const morning = unavoidableNeedKwh({
			slotStartIso: "2026-08-09T07:00:00.000Z",
			slotMs: Date.parse("2026-08-09T07:00:00.000Z"),
			recoveryMs,
			nightReserveKwh: 2.5,
			timeZone: TZ,
		});
		assert.ok(morning <= 0.6, `morning cushion got ${morning}`);
	});

	it("usable = soc − floor (discharge-eff adjusted)", () => {
		assert.ok(usableBatteryEnergyKwh(10, 3.5, 0.95) > 5.5);
		assert.equal(usableBatteryEnergyKwh(3, 3.5, 0.95), 0);
	});

	it("finds PV recovery when forward surplus accumulates", () => {
		const slots = buildSlots("2026-08-08T14:00:00.000Z", 48).map((s) => {
			const h = new Date(s.startIso).getUTCHours();
			const day1 = Date.parse(s.startIso) >= Date.parse("2026-08-09T00:00:00.000Z");
			const power = day1 && h >= 7 && h < 16 ? 4000 : 0;
			return {
				startIso: s.startIso,
				endIso: s.endIso,
				startMs: Date.parse(s.startIso),
				pvKwh: (power / 1000) * 0.25,
				houseKwh: 0.2,
				importCt: 28,
			};
		});
		const idx = findPvRecoverySlotIdx(slots, 0);
		assert.ok(idx !== null && idx! > 0);
	});
});

describe("Beta-004 flex — Klima aus Batterie bei späterer PV-Recovery", () => {
	it("allows climate battery when SOC high, afternoon PV weak, tomorrow strong", () => {
		const nowIso = "2026-08-08T15:00:00.000Z"; // 17:00 CEST — wenig PV
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
			dischargeLiveSupported: true,
			passiveBatteryEnergyAvailable: true,
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
		const plan = allocateUnifiedDayPlan(input);
		const climateBat = sumKind(plan, "climate", (a) => a.energySource === "battery");
		assert.ok(climateBat > 0.3, `expected climate from battery, got ${climateBat}`);
		assert.ok(plan.reasonCodes.includes(REASON.BATTERY_FLEX_USABLE));
		const last = plan.batteryTrajectory[plan.batteryTrajectory.length - 1];
		assert.ok(last?.socPct == null || last.socPct >= 20);
	});
});

describe("Beta-004 flex — Wallbox aus Batterie ohne %-Cap", () => {
	it("may deliver several kWh from battery when reserve+recovery secured", () => {
		const nowIso = "2026-08-08T18:00:00.000Z";
		const slots = buildSlots(nowIso, 48);
		const input = golden001Input();
		input.globalMode = "balanced";
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
			const day1 = Date.parse(s.startIso) >= Date.parse("2026-08-09T06:00:00.000Z");
			const power = day1 && h >= 7 && h < 16 ? 4500 : 0;
			return {
				slot: s,
				forecastPowerW: power,
				observedPowerW: null,
				energyKwh: (power / 1000) * 0.25,
			};
		});
		input.battery = {
			...input.battery,
			socPct: 95,
			usableCapacityKwh: 10,
			minSocPct: 10,
			reserveSocPct: 10,
			nightReserveKwh: 2.5,
			endSocTargetPct: 35,
			requiredChargeEnergyKwh: 0,
			dischargeLiveSupported: true,
			passiveBatteryEnergyAvailable: true,
			uncertainty: Q,
			freshness: FRESH,
		};
		input.thermal = { ...input.thermal!, headroomEnergyKwh: 0.1 };
		input.climate = null;
		input.wallbox = {
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					status: "available",
					source: "explicit",
					hard: true,
					startIso: nowIso,
					endIso: "2026-08-09T05:00:00.000Z",
				},
			],
			presenceHardConstraint: true,
			vehicleProfileId: "car",
			vehicleSocPct: 40,
			socSource: "direct",
			fallbackEnergyNeedKwh: null,
			vehicleCapacityKwh: 60,
			targetSocPct: 80,
			requiredEnergyKwh: 8,
			deadlineIso: "2026-08-09T05:00:00.000Z",
			energyGoalHard: true,
			minChargePowerW: 1400,
			maxChargePowerW: 11000,
			chargeLossFactor: 1.1,
			evccExecutionMaster: true,
			evccChargeMode: "minpv",
			batteryHoldRequested: false,
			uncertainty: Q,
			freshness: FRESH,
		};
		const plan = allocateUnifiedDayPlan(input);
		const wbBat = sumKind(plan, "wallbox", (a) => a.energySource === "battery");
		const wbTotal = sumKind(plan, "wallbox");
		assert.ok(wbTotal > 2, `wallbox should get energy, got ${wbTotal}`);
		// Kein festes 50 %-Cap — mehrere kWh aus Batterie erlaubt wenn Floor hält.
		assert.ok(wbBat > 1.0, `expected >1 kWh battery→wallbox (no 50% cap), got ${wbBat}`);
		assert.ok(plan.reasonCodes.includes(REASON.BATTERY_FROM_RESERVE_FLEX));
	});
});

describe("Beta-004 flex — Thermal aus Batterie bei kritischer Deadline", () => {
	it("may heat from battery when PV before emptyAt insufficient and SOC high", () => {
		const nowIso = "2026-08-08T14:30:00.000Z";
		const emptyAt = "2026-08-08T16:00:00.000Z";
		const slots = buildSlots(nowIso, 48);
		const input = golden001Input();
		input.globalMode = "balanced";
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
			const day1 = Date.parse(s.startIso) >= Date.parse("2026-08-09T06:00:00.000Z");
			const power = day1 && h >= 8 && h < 15 ? 4000 : 50;
			return {
				slot: s,
				forecastPowerW: power,
				observedPowerW: null,
				energyKwh: (power / 1000) * 0.25,
			};
		});
		input.battery = {
			...input.battery,
			socPct: 88,
			usableCapacityKwh: 10,
			minSocPct: 10,
			reserveSocPct: 10,
			nightReserveKwh: 2.5,
			endSocTargetPct: 40,
			requiredChargeEnergyKwh: 0,
			dischargeLiveSupported: true,
			passiveBatteryEnergyAvailable: true,
			uncertainty: Q,
			freshness: FRESH,
		};
		input.wallbox = null;
		input.climate = null;
		input.thermal = {
			...input.thermal!,
			bufferTempC: 45,
			headroomEnergyKwh: 3.5,
			availablePowerW: 1700,
			minPowerW: 1700,
			deadlineIso: emptyAt,
			estimatedEmptyAtIso: emptyAt,
			emptyAtSource: "estimated",
			nightBridgeActive: true,
		};
		const plan = allocateUnifiedDayPlan(input);
		const batHeat = sumKind(
			plan,
			"immersion_heater",
			(a) => a.energySource === "battery" || a.energySource === "mixed",
		);
		assert.ok(batHeat > 0.4, `expected thermal from battery, got ${batHeat}`);
	});
});

describe("Beta-004 flex — Reserve schützen bei niedrigem SOC", () => {
	it("does not drain battery for climate when at night reserve floor", () => {
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
		input.pv.slots = slots.map((s) => ({
			slot: s,
			forecastPowerW: 100,
			observedPowerW: null,
			energyKwh: 0.025,
		}));
		input.battery = {
			...input.battery,
			socPct: 25, // 2.5 kWh = Nachtreserve-Floor → usable = 0
			usableCapacityKwh: 10,
			minSocPct: 10,
			reserveSocPct: 10,
			nightReserveKwh: 2.5,
			endSocTargetPct: 40,
			requiredChargeEnergyKwh: 0,
			dischargeLiveSupported: true,
			passiveBatteryEnergyAvailable: true,
			uncertainty: Q,
			freshness: FRESH,
		};
		input.wallbox = null;
		input.thermal = { ...input.thermal!, headroomEnergyKwh: 0.2 };
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
					expectedEnergyKwh: 2,
					typicalPowerW: 900,
					maxShiftHours: 0,
					uncertainty: Q,
				},
			],
			freshness: FRESH,
		};
		const plan = allocateUnifiedDayPlan(input);
		const climateBat = sumKind(plan, "climate", (a) => a.energySource === "battery");
		assert.equal(climateBat, 0, `must protect reserve floor, got climateBat=${climateBat}`);
	});
});

describe("battery_reserve_floor build aligns with input", () => {
	it("builds per-slot floor from night + safety", () => {
		const nowIso = "2026-08-08T12:00:00.000Z";
		const slots = buildSlots(nowIso, 32).map((s) => ({
			startIso: s.startIso,
			endIso: s.endIso,
			startMs: Date.parse(s.startIso),
			pvKwh: 0.5,
			houseKwh: 0.2,
			importCt: 25,
		}));
		const input = golden001Input();
		input.time.nowIso = nowIso;
		input.time.timezone = TZ;
		input.battery = {
			...input.battery,
			usableCapacityKwh: 10,
			minSocPct: 10,
			reserveSocPct: 10,
			nightReserveKwh: 2.5,
		};
		const floor = buildBatteryReserveFloor(input, slots);
		assert.ok(floor.requiredKwhBySlot.length === slots.length);
		assert.ok(floor.requiredKwhBySlot[0]! >= 2.5);
		assert.ok(floor.recoverySlotIdx !== null);
	});
});

describe("Beta-004 thermal flex storage — replan yields PV to vehicle", () => {
	it("high thermal PV first; after vehicle arrives wallbox takes PV and thermal shrinks", () => {
		const nowIso = "2026-08-08T11:00:00.000Z";
		const emptyAt = "2026-08-08T15:44:00.000Z";
		const slots = buildSlots(nowIso, 40);

		const mkBase = () => {
			const input = golden001Input();
			input.globalMode = "balanced";
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
				if (day0 && h >= 9 && h < 16) power = 4800;
				else if (!day0 && h >= 8 && h < 15) power = 4000;
				return {
					slot: s,
					forecastPowerW: power,
					observedPowerW: null,
					energyKwh: (power / 1000) * 0.25,
				};
			});
			input.pv.expectedDayEnergyKwh = 32;
			input.houseLoad.slots = slots.map((s) => ({
				slot: s,
				forecastPowerW: 600,
				observedPowerW: null,
				energyKwh: 0.15,
			}));
			input.battery = {
				...input.battery,
				socPct: 95,
				usableCapacityKwh: 10,
				minSocPct: 10,
				reserveSocPct: 10,
				nightReserveKwh: 2.5,
				endSocTargetPct: 36,
				requiredChargeEnergyKwh: 0,
				dischargeLiveSupported: true,
				passiveBatteryEnergyAvailable: true,
				uncertainty: Q,
				freshness: FRESH,
			};
			input.climate = {
				units: [
					{
						unitId: "air_conditioning.unit_1",
						label: "wohn",
						roomTempC: 24,
						comfortMinC: null,
						comfortMaxC: 26,
						targetTempC: 25.5,
						mandatoryComfort: false,
						expectedEnergyKwh: 2.5,
						typicalPowerW: 900,
						maxShiftHours: 4,
						uncertainty: Q,
					},
				],
				freshness: FRESH,
			};
			return input;
		};

		const noCar = mkBase();
		noCar.wallbox = null;
		noCar.thermal = {
			...noCar.thermal!,
			bufferTempC: 47,
			minTempC: 44,
			maxTempC: 63,
			dayTargetTempC: 58,
			headroomEnergyKwh: 5.5,
			availablePowerW: 1700,
			minPowerW: 1700,
			deadlineIso: emptyAt,
			estimatedEmptyAtIso: emptyAt,
			emptyAtSource: "estimated",
			nightBridgeActive: true,
		};
		const planA = allocateUnifiedDayPlan(noCar);
		const ihA = sumKind(planA, "immersion_heater");
		assert.ok(ihA > 2.5, `thermal flex storage should absorb PV, got ${ihA}`);

		// Replan: Fahrzeug kommt mit Ladebedarf; Puffer bereits höher (gespeicherte Wärme).
		const withCar = mkBase();
		withCar.thermal = {
			...noCar.thermal!,
			bufferTempC: 56,
			dayTargetTempC: 53,
			headroomEnergyKwh: 1.2,
			deadlineIso: emptyAt,
			estimatedEmptyAtIso: emptyAt,
		};
		withCar.wallbox = {
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					status: "available",
					source: "explicit",
					hard: true,
					startIso: nowIso,
					endIso: "2026-08-09T04:00:00.000Z",
				},
			],
			presenceHardConstraint: true,
			vehicleProfileId: "car",
			vehicleSocPct: 35,
			socSource: "direct",
			fallbackEnergyNeedKwh: null,
			vehicleCapacityKwh: 60,
			targetSocPct: 80,
			requiredEnergyKwh: 14,
			deadlineIso: "2026-08-09T04:00:00.000Z",
			energyGoalHard: true,
			minChargePowerW: 1400,
			maxChargePowerW: 11000,
			chargeLossFactor: 1.05,
			evccExecutionMaster: true,
			evccChargeMode: "minpv",
			batteryHoldRequested: false,
			uncertainty: Q,
			freshness: FRESH,
		};
		const planB = allocateUnifiedDayPlan(withCar);
		const ihB = sumKind(planB, "immersion_heater");
		const wbPv = sumKind(planB, "wallbox", (a) => a.energySource === "pv_surplus");
		assert.ok(ihB < ihA - 1.0, `replan must cut thermal vs A: A=${ihA} B=${ihB}`);
		assert.ok(wbPv > 2.0, `vehicle should get PV after replan, got ${wbPv}`);
	});
});
