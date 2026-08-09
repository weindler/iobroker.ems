/**
 * Ziel-/kostenbasierte Unified Optimization — Abnahme A–J + Anti-Priorität.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../../quality";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildSlots, golden001Input } from "./fixtures";
import { buildProductSummaryDe, buildUnifiedDayAgendaDe } from "../../../beta/product_summary";
import type { UnifiedDayPlannerInput, UnifiedWallboxInput } from "./types";

const TZ = "Europe/Berlin";
const Q = operatorQuality("valid", "cost-opt", 85);
const FRESH = { observedAtIso: "2026-08-08T08:55:00.000Z", ageSec: 5, quality: Q };

function sumKind(
	plan: ReturnType<typeof allocateUnifiedDayPlan>,
	kind: string,
	pred?: (a: (typeof plan.allocations)[0]) => boolean,
): number {
	return plan.allocations
		.filter((a) => a.kind === kind && (!pred || pred(a)))
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

function wallboxBase(overrides: Partial<UnifiedWallboxInput> = {}): UnifiedWallboxInput {
	return {
		connectedNow: true,
		presenceWindows: [
			{
				available: true,
				status: "available",
				source: "explicit",
				hard: true,
				startIso: "2026-08-08T08:55:00.000Z",
				endIso: "2026-08-10T00:00:00.000Z",
			},
		],
		presenceHardConstraint: true,
		vehicleProfileId: "ford_explorer",
		vehicleSocPct: 35,
		socSource: "direct",
		fallbackEnergyNeedKwh: null,
		vehicleCapacityKwh: 79,
		targetSocPct: 80,
		requiredEnergyKwh: 35.55, // (80-35)% * 79
		deadlineIso: "2026-08-09T03:30:00.000Z", // 05:30 CEST
		energyGoalHard: true,
		minChargePowerW: 1380,
		maxChargePowerW: 11000,
		chargeLossFactor: 1.05,
		evccExecutionMaster: true,
		evccChargeMode: null,
		batteryHoldRequested: false,
		uncertainty: Q,
		freshness: FRESH,
		...overrides,
	};
}

function baseHorizon(nowIso = "2026-08-08T08:55:00.000Z", hours = 40): UnifiedDayPlannerInput {
	const slots = buildSlots(nowIso, hours);
	const base = golden001Input();
	base.time = {
		...base.time,
		nowIso,
		timezone: TZ,
		slots,
		horizonStartIso: slots[0]!.startIso,
		horizonEndIso: slots[slots.length - 1]!.endIso,
	};
	base.pv.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		const day0 = Date.parse(s.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
		let power = 0;
		if (day0 && h >= 7 && h < 16) power = h < 14 ? 4000 : 1500;
		else if (!day0 && h >= 7 && h < 16) power = 3800;
		return { slot: s, forecastPowerW: power, observedPowerW: null, energyKwh: (power / 1000) * 0.25 };
	});
	base.pv.expectedDayEnergyKwh = 43.6;
	base.houseLoad.slots = slots.map((s) => ({
		slot: s,
		forecastPowerW: 800,
		observedPowerW: null,
		energyKwh: 0.2,
	}));
	base.houseLoad.expectedDayEnergyKwh = 22;
	base.prices.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		const night = h >= 22 || h < 5;
		return {
			slot: s,
			importCtPerKwh: night ? 12 : 32,
			exportCtPerKwh: 8,
			gridImportAllowed: true,
		};
	});
	base.battery = {
		...base.battery,
		socPct: 60,
		usableCapacityKwh: 10,
		nightReserveKwh: 2.5,
		requiredChargeEnergyKwh: null,
		endSocTargetPct: null,
		gridChargeAllowed: true,
		uncertainty: Q,
		freshness: FRESH,
	};
	base.thermal = {
		...base.thermal!,
		bufferTempC: 49,
		headroomEnergyKwh: 3.5,
		deadlineIso: "2026-08-08T15:25:00.000Z",
		estimatedEmptyAtIso: "2026-08-08T15:25:00.000Z",
		emptyAtSource: "estimated",
		nightBridgeActive: true,
		reheatHysteresisActive: false,
		uncertainty: Q,
		freshness: FRESH,
	};
	base.climate = {
		units: [
			{
				unitId: "air_conditioning.unit_1",
				label: "Wohnzimmer",
				roomTempC: 26.5,
				comfortMinC: null,
				comfortMaxC: 25.5,
				targetTempC: 25,
				mandatoryComfort: true,
				expectedEnergyKwh: 2.5,
				typicalPowerW: 900,
				maxShiftHours: 0,
				uncertainty: Q,
			},
		],
		freshness: FRESH,
	};
	base.wallbox = null;
	base.globalMode = "balanced";
	return base;
}

describe("COST-A beta SOC100 + thermal + climate", () => {
	it("no battery charge; parallel climate + thermal", () => {
		const input = baseHorizon();
		input.battery = { ...input.battery, socPct: 100, requiredChargeEnergyKwh: 0 };
		const plan = allocateUnifiedDayPlan(input);
		assert.equal(sumKind(plan, "battery_charge"), 0);
		assert.ok(sumKind(plan, "immersion_heater") > 1);
		assert.ok(sumKind(plan, "climate") > 1);
	});
});

describe("COST-B Explorer + little PV + cheap night", () => {
	it("meets deadline using cheap night grid", () => {
		const input = baseHorizon();
		input.pv.slots = input.pv.slots.map((s) => ({
			...s,
			forecastPowerW: 400,
			energyKwh: 0.1,
		}));
		input.pv.expectedDayEnergyKwh = 6;
		input.wallbox = wallboxBase({ evccChargeMode: null });
		const plan = allocateUnifiedDayPlan(input);
		const grid = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
		const goal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
		assert.ok(grid > 15, `expected substantial night/grid charge, got ${grid}`);
		assert.ok(goal?.met !== false, String(goal?.detailDe));
		const eco = plan.vehicleChargeEconomics!;
		assert.ok((eco.expectedGridCostCt ?? 9999) < 35 * 32); // not all at expensive day rate
		const agenda = buildUnifiedDayAgendaDe(plan);
		const summary = buildProductSummaryDe(plan, { batteryStartSocPct: 60 });
		assert.ok(agenda.some((l) => /Fahrzeug/i.test(l)) || /Fahrzeug|Netz/i.test(summary));
		// eslint-disable-next-line no-console
		console.log("\n=== COST-B PLAN ===\n", summary, "\n", agenda.join("\n"));
	});
});

describe("COST-C Explorer + strong tomorrow PV + evening deadline", () => {
	it("shifts charge into tomorrow PV window when deadline allows", () => {
		const input = baseHorizon();
		// Today weak, tomorrow strong; deadline tomorrow evening
		input.pv.slots = input.pv.slots.map((s) => {
			const day0 = Date.parse(s.slot.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
			const h = new Date(s.slot.startIso).getUTCHours();
			const power = day0 ? (h >= 10 && h < 14 ? 800 : 200) : h >= 7 && h < 16 ? 5000 : 0;
			return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
		});
		input.prices.slots = input.prices.slots.map((s) => {
			const h = new Date(s.slot.startIso).getUTCHours();
			const night = h >= 22 || h < 5;
			return { ...s, importCtPerKwh: night ? 38 : 28 }; // night expensive
		});
		input.wallbox = wallboxBase({
			deadlineIso: "2026-08-09T18:00:00.000Z",
			requiredEnergyKwh: 20,
		});
		const plan = allocateUnifiedDayPlan(input);
		const pvWb = sumKind(plan, "wallbox", (a) => a.energySource === "pv_surplus");
		const gridWb = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
		assert.ok(pvWb > gridWb, `prefer tomorrow PV: pv=${pvWb} grid=${gridWb}`);
		// eslint-disable-next-line no-console
		console.log("\n=== COST-C PLAN ===\n", buildUnifiedDayAgendaDe(plan).join("\n"), `\npv=${pvWb} grid=${gridWb}`);
	});
});

describe("COST-D immediate/schnell → battery hold", () => {
	it("blocks battery charge while immediate EV charging", () => {
		const input = baseHorizon();
		input.battery = { ...input.battery, socPct: 40 };
		input.wallbox = wallboxBase({
			evccChargeMode: "now",
			batteryHoldRequested: true,
			deadlineIso: "2026-08-08T14:00:00.000Z",
			requiredEnergyKwh: 12,
		});
		const plan = allocateUnifiedDayPlan(input);
		assert.equal(sumKind(plan, "battery_charge"), 0, "battery hold during immediate");
		assert.ok(sumKind(plan, "wallbox") > 5);
	});
});

describe("COST-E climate + vehicle compete", () => {
	it("covers hard vehicle goal and mandatory climate together", () => {
		const input = baseHorizon();
		input.pv.slots = input.pv.slots.map((s) => ({
			...s,
			forecastPowerW: 1200,
			energyKwh: 0.3,
		}));
		input.wallbox = wallboxBase({ requiredEnergyKwh: 12, deadlineIso: "2026-08-09T03:30:00.000Z" });
		input.battery = { ...input.battery, socPct: 70, nightReserveKwh: 2.5 };
		const plan = allocateUnifiedDayPlan(input);
		const wb = sumKind(plan, "wallbox");
		const climate = sumKind(plan, "climate");
		assert.ok(wb > 8, `vehicle energy ${wb}`);
		assert.ok(climate > 1, `climate energy ${climate}`);
		const goal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
		assert.ok(goal?.met === true || wb >= 11, `goal=${goal?.met} detail=${goal?.detailDe}`);
		// eslint-disable-next-line no-console
		console.log("\n=== COST-E PLAN ===\n", buildUnifiedDayAgendaDe(plan).join("\n"));
	});
});

describe("COST-F thermal + climate + low battery", () => {
	it("does not invent fixed addon order — both get energy from situation", () => {
		const input = baseHorizon();
		input.battery = { ...input.battery, socPct: 15, nightReserveKwh: 2.5 };
		input.thermal = { ...input.thermal!, headroomEnergyKwh: 3, deadlineIso: "2026-08-08T14:00:00.000Z" };
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "immersion_heater") > 0.5);
		assert.ok(sumKind(plan, "climate") > 0.5);
		assert.equal(
			sumKind(plan, "immersion_heater", (a) => a.energySource === "battery"),
			0,
		);
	});
});

describe("COST-G extremely cheap grid → conscious import OK", () => {
	it("may use cheap grid for vehicle while leaving battery on hold path", () => {
		const input = baseHorizon();
		input.prices.slots = input.prices.slots.map((s) => ({
			...s,
			importCtPerKwh: 8,
			exportCtPerKwh: 2,
		}));
		input.pv.slots = input.pv.slots.map((s) => ({ ...s, forecastPowerW: 300, energyKwh: 0.075 }));
		input.battery = { ...input.battery, socPct: 55 };
		input.wallbox = wallboxBase({ requiredEnergyKwh: 25 });
		const plan = allocateUnifiedDayPlan(input);
		const grid = sumKind(plan, "wallbox", (a) => a.energySource === "grid");
		assert.ok(grid > 10);
		assert.ok(plan.allocations.some((a) => a.reasonCodes.includes("grid_import_cost_optimal")));
		// eslint-disable-next-line no-console
		console.log("\n=== COST-G PLAN ===\n", buildProductSummaryDe(plan, { batteryStartSocPct: 55 }));
	});
});

describe("COST-H extremely expensive grid → prefer PV/flex", () => {
	it("avoids grid for soft loads when import is very expensive", () => {
		const input = baseHorizon();
		input.prices.slots = input.prices.slots.map((s) => ({
			...s,
			importCtPerKwh: 55,
			exportCtPerKwh: 12,
		}));
		input.wallbox = null;
		input.climate = {
			units: [
				{
					unitId: "air_conditioning.unit_1",
					label: "Wohnzimmer",
					roomTempC: 24,
					comfortMinC: null,
					comfortMaxC: 26,
					targetTempC: 25,
					mandatoryComfort: false,
					expectedEnergyKwh: 2,
					typicalPowerW: 900,
					maxShiftHours: 4,
					uncertainty: Q,
				},
			],
			freshness: FRESH,
		};
		const plan = allocateUnifiedDayPlan(input);
		const climateGrid = sumKind(plan, "climate", (a) => a.energySource === "grid");
		assert.ok(climateGrid < 0.3, `flex climate should avoid expensive grid, got ${climateGrid}`);
		assert.ok(sumKind(plan, "immersion_heater") > 0.5 || sumKind(plan, "climate") > 0.5);
	});
});

describe("COST-I same state, different global modes", () => {
	it("eco vs comfort produce different allocation emphasis", () => {
		const mk = (mode: string) => {
			const input = baseHorizon();
			input.globalMode = mode;
			input.battery = { ...input.battery, socPct: 45 };
			input.wallbox = wallboxBase({ requiredEnergyKwh: 15 });
			input.climate = {
				units: [
					{
						unitId: "air_conditioning.unit_1",
						label: "Wohnzimmer",
						roomTempC: 26,
						comfortMinC: null,
						comfortMaxC: 25.5,
						targetTempC: 25,
						mandatoryComfort: true,
						expectedEnergyKwh: 3,
						typicalPowerW: 900,
						maxShiftHours: 0,
						uncertainty: Q,
					},
				],
				freshness: FRESH,
			};
			return allocateUnifiedDayPlan(input);
		};
		const eco = mk("eco");
		const comfort = mk("comfort");
		const ecoClimate = sumKind(eco, "climate");
		const comfortClimate = sumKind(comfort, "climate");
		const ecoBat = sumKind(eco, "battery_charge");
		const comfortBat = sumKind(comfort, "battery_charge");
		const ecoClimateBat = sumKind(eco, "climate", (a) => a.energySource === "battery");
		const comfortClimateBat = sumKind(comfort, "climate", (a) => a.energySource === "battery");
		const different =
			Math.abs(ecoClimate - comfortClimate) > 0.15 ||
			Math.abs(ecoBat - comfortBat) > 0.15 ||
			Math.abs(sumKind(eco, "wallbox") - sumKind(comfort, "wallbox")) > 0.15 ||
			Math.abs(ecoClimateBat - comfortClimateBat) > 0.05 ||
			eco.expectedCostCt !== comfort.expectedCostCt;
		assert.ok(different, "eco and comfort must diverge on at least one dimension");
		// Keine PV-Export/Batterie-Arbitrage: bei PV-Surplus kein Klima aus Batterie.
		assert.equal(ecoClimateBat, 0, "eco must not drain battery while PV can cover climate");
		assert.equal(comfortClimateBat, 0, "comfort must not drain battery for export arbitrage");
		// eslint-disable-next-line no-console
		console.log("\n=== COST-I eco vs comfort ===", {
			eco: {
				climate: ecoClimate,
				climateBat: ecoClimateBat,
				batCharge: ecoBat,
				wb: sumKind(eco, "wallbox"),
				export: eco.expectedGridExportEnergyKwh,
				cost: eco.expectedCostCt,
			},
			comfort: {
				climate: comfortClimate,
				climateBat: comfortClimateBat,
				batCharge: comfortBat,
				wb: sumKind(comfort, "wallbox"),
				export: comfort.expectedGridExportEnergyKwh,
				cost: comfort.expectedCostCt,
			},
		});
	});
});

describe("COST-BAT-OPP no battery drain to free PV export", () => {
	it("prefers PV for load when export is modest and later import is expensive", () => {
		const input = baseHorizon();
		input.globalMode = "comfort";
		input.battery = {
			...input.battery,
			socPct: 70,
			nightReserveKwh: 2.5,
			dischargeLiveSupported: true,
			passiveBatteryEnergyAvailable: true,
		};
		input.prices.slots = input.prices.slots.map((s) => {
			const h = new Date(s.slot.startIso).getUTCHours();
			const lateExpensive = h >= 17 && h < 22;
			return {
				...s,
				importCtPerKwh: lateExpensive ? 48 : 22,
				exportCtPerKwh: 9.3,
				gridImportAllowed: true,
			};
		});
		// Starke aktuelle PV, genug für Klima
		input.pv.slots = input.pv.slots.map((s) => {
			const h = new Date(s.slot.startIso).getUTCHours();
			const day0 = Date.parse(s.slot.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
			const power = day0 && h >= 9 && h < 15 ? 4500 : day0 && h >= 7 && h < 17 ? 1200 : 0;
			return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
		});
		input.wallbox = null;
		input.thermal = { ...input.thermal!, headroomEnergyKwh: 0.5 };
		input.climate = {
			units: [
				{
					unitId: "air_conditioning.unit_1",
					label: "Wohnzimmer",
					roomTempC: 27,
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
		const climatePv = sumKind(plan, "climate", (a) => a.energySource === "pv_surplus");
		const climateBat = sumKind(plan, "climate", (a) => a.energySource === "battery");
		assert.ok(climatePv > 1.5, `climate should run on PV, got pv=${climatePv}`);
		assert.equal(climateBat, 0, `battery must stay reserved for later expensive hours, got ${climateBat}`);
	});
});

describe("COST-J no deadline + lots of PV", () => {
	it("raises self-consumption without forcing battery to 100%", () => {
		const input = baseHorizon();
		input.wallbox = null;
		input.battery = { ...input.battery, socPct: 70, nightReserveKwh: 2.5 };
		input.thermal = {
			...input.thermal!,
			deadlineIso: null,
			estimatedEmptyAtIso: null,
			emptyAtSource: null,
			nightBridgeActive: false,
			headroomEnergyKwh: 2,
		};
		const plan = allocateUnifiedDayPlan(input);
		const bat = sumKind(plan, "battery_charge");
		const ih = sumKind(plan, "immersion_heater");
		assert.ok(bat + ih > 1);
		const endSoc = plan.batteryTrajectory[plan.batteryTrajectory.length - 1]?.socPct;
		assert.ok(endSoc === null || endSoc <= 100);
		assert.ok(endSoc === null || endSoc < 99.5 || bat < 3, "must not blindly max battery");
	});
});

describe("COST-ANTI fixed addon priority forbidden", () => {
	it("same addons, different deadlines/prices → different energy mix", () => {
		const cheapNightVehicle = baseHorizon();
		cheapNightVehicle.climate = null; // isolate vehicle vs thermal priority
		cheapNightVehicle.pv.slots = cheapNightVehicle.pv.slots.map((s) => ({
			...s,
			forecastPowerW: 500,
			energyKwh: 0.125,
		}));
		cheapNightVehicle.wallbox = wallboxBase({
			deadlineIso: "2026-08-09T03:30:00.000Z",
			requiredEnergyKwh: 22,
		});
		cheapNightVehicle.thermal = {
			...cheapNightVehicle.thermal!,
			headroomEnergyKwh: 2,
			deadlineIso: "2026-08-09T20:00:00.000Z",
		};

		const thermalUrgent = baseHorizon();
		thermalUrgent.climate = null;
		thermalUrgent.pv.slots = thermalUrgent.pv.slots.map((s) => {
			const h = new Date(s.slot.startIso).getUTCHours();
			const power = h >= 9 && h < 14 ? 4500 : 200;
			return { ...s, forecastPowerW: power, energyKwh: (power / 1000) * 0.25 };
		});
		thermalUrgent.prices.slots = thermalUrgent.prices.slots.map((s) => ({
			...s,
			importCtPerKwh: 40,
		}));
		thermalUrgent.wallbox = wallboxBase({
			deadlineIso: "2026-08-09T20:00:00.000Z",
			requiredEnergyKwh: 8,
			energyGoalHard: false,
		});
		thermalUrgent.thermal = {
			...thermalUrgent.thermal!,
			headroomEnergyKwh: 4,
			deadlineIso: "2026-08-08T13:00:00.000Z",
			emptyAtSource: "learned",
		};

		const p1 = allocateUnifiedDayPlan(cheapNightVehicle);
		const p2 = allocateUnifiedDayPlan(thermalUrgent);

		const mix = (p: typeof p1) => ({
			wbGrid: sumKind(p, "wallbox", (a) => a.energySource === "grid"),
			wbPv: sumKind(p, "wallbox", (a) => a.energySource === "pv_surplus"),
			ih: sumKind(p, "immersion_heater"),
		});
		const m1 = mix(p1);
		const m2 = mix(p2);
		assert.ok(m1.wbGrid > m2.wbGrid + 2, `cheap-night vehicle uses more grid: ${JSON.stringify({ m1, m2 })}`);
		assert.ok(m2.ih > m1.ih + 0.5, `urgent thermal gets more IH: ${JSON.stringify({ m1, m2 })}`);
		// Score-Mix muss sich mit Deadlines/Preisen drehen — keine feste Add-on-Reihenfolge.
		const mixDiffers =
			Math.abs(m1.wbGrid - m2.wbGrid) > 2 ||
			Math.abs(m1.wbPv - m2.wbPv) > 1 ||
			Math.abs(m1.ih - m2.ih) > 0.5;
		assert.ok(mixDiffers, `energy mix must diverge: ${JSON.stringify({ m1, m2 })}`);
	});
});
