import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { PlanContribution } from "../types";
import type { UnifiedAllocationCell, UnifiedDayPlan, UnifiedDayPlannerInput } from "../daily_plan/unified/types";
import { operatorQuality } from "../quality";
import { buildOperationalAssessment, formatOperationalAssessmentDe, type AssessmentBuildInput } from "./build";

const NOW = new Date("2026-09-03T11:00:00.000Z");
const TZ = "Europe/Berlin";
const Q = operatorQuality("valid", "ok");

function fresh(over: Partial<UnifiedData> = {}): UnifiedData {
	return {
		observedAtIso: NOW.toISOString(),
		ageSec: 0,
		quality: Q,
	};
}

type UnifiedData = UnifiedDayPlannerInput["time"]["freshness"];

function slot(startIso: string, endIso: string) {
	return { startIso, endIso, durationMinutes: 15 };
}

function cell(
	kind: UnifiedAllocationCell["kind"],
	startIso: string,
	endIso: string,
	w = 700,
): UnifiedAllocationCell {
	return {
		slot: slot(startIso, endIso),
		consumerId: `${kind}.1`,
		kind,
		allocatedPowerW: w,
		allocatedEnergyKwh: (w / 1000) * 0.25,
		energySource: "pv_surplus",
		constraintIds: [],
		reasonCodes: [],
	};
}

function emptyPlan(alloc: UnifiedAllocationCell[] = []): UnifiedDayPlan {
	return {
		schemaVersion: 1,
		planId: "p1",
		generation: 1,
		inputRevision: 1,
		createdAtIso: NOW.toISOString(),
		timezone: TZ,
		horizonStartIso: "2026-09-03T00:00:00.000Z",
		horizonEndIso: "2026-09-04T22:00:00.000Z",
		globalMode: "balanced",
		allocations: alloc,
		constraints: [],
		goalStatuses: [],
		reasonCodes: ["battery_night_reserve"],
		reasonDe: "ok",
		totals: {
			expectedPvKwh: 12,
			expectedHouseLoadKwh: 10,
			plannedFlexKwh: 0,
			plannedGridImportKwh: 0,
			plannedFeedInKwh: 2,
		},
	} as unknown as UnifiedDayPlan;
}

function planner(over: Partial<UnifiedDayPlannerInput> = {}): UnifiedDayPlannerInput {
	return {
		schemaVersion: 1,
		planIntent: "unified_day",
		time: {
			nowIso: NOW.toISOString(),
			timezone: TZ,
			horizonStartIso: "2026-09-03T00:00:00.000Z",
			horizonEndIso: "2026-09-04T22:00:00.000Z",
			slotMinutes: 15,
			slots: [],
			freshness: fresh(),
		},
		pv: {
			slots: [],
			expectedDayEnergyKwh: 12,
			previousExpectedDayEnergyKwh: null,
			biasCorrected: true,
			biasPct: null,
			uncertainty: Q,
			freshness: fresh(),
		},
		prices: { slots: [], uncertainty: Q, freshness: fresh() },
		houseLoad: { slots: [], expectedDayEnergyKwh: 10, uncertainty: Q, freshness: fresh() },
		battery: {
			socPct: 100,
			usableCapacityKwh: 20,
			minSocPct: 10,
			maxSocPct: 100,
			maxChargePowerW: 5000,
			maxDischargePowerW: 5000,
			chargeEfficiency: 0.95,
			dischargeEfficiency: 0.95,
			allowedModes: ["charge"],
			reserveSocPct: 20,
			nightReserveKwh: 3,
			profileId: null,
			dischargeLiveSupported: false,
			passiveBatteryEnergyAvailable: true,
			requiredChargeEnergyKwh: null,
			endSocTargetPct: null,
			chargeDeadlineIso: null,
			uncertainty: Q,
			freshness: fresh(),
		},
		wallbox: {
			connectedNow: false,
			presenceWindows: [],
			presenceHardConstraint: true,
			vehicleProfileId: null,
			vehicleSocPct: 77,
			socSource: "evcc",
			fallbackEnergyNeedKwh: null,
			vehicleCapacityKwh: 60,
			targetSocPct: 80,
			requiredEnergyKwh: 0.1,
			deadlineIso: null,
			energyGoalHard: false,
			minChargePowerW: 1400,
			maxChargePowerW: 11000,
			chargeLossFactor: 1,
			evccExecutionMaster: true,
			evccChargeMode: "pv",
			uncertainty: Q,
			freshness: fresh(),
		},
		thermal: {
			bufferTempC: 62.3,
			boilerTempC: 67,
			minTempC: 45,
			boilerMinTempC: 45,
			maxTempC: 63,
			dayTargetTempC: 62.7,
			availablePowerW: 3000,
			minPowerW: 500,
			headroomEnergyKwh: 0,
			estimatedEmptyAtIso: null,
			deadlineIso: null,
			emptyAtSource: null,
			nightBridgeActive: false,
			coolingRateCPerH: null,
			minimumRuntimeSec: null,
			hysteresisK: 3,
			reheatHysteresisActive: true,
			uncertainty: Q,
			freshness: fresh(),
		},
		climate: { units: [], freshness: fresh() },
		otherFlex: [],
		contributionRevision: 1,
		globalMode: "balanced",
		...over,
	} as UnifiedDayPlannerInput;
}

function priceDay(dateKey: string, hours: Array<[number, number]>) {
	return hours.map(([h, ct]) => ({
		slot: {
			startIso: `${dateKey}T${String(h).padStart(2, "0")}:00:00.000Z`,
			endIso: `${dateKey}T${String(h).padStart(2, "0")}:15:00.000Z`,
			durationMinutes: 15,
		},
		importCtPerKwh: ct,
		exportCtPerKwh: 8,
		gridImportAllowed: true,
	}));
}

function climateContrib(over: Record<string, unknown> = {}): PlanContribution {
	return {
		contributionId: "air_conditioning.unit_1",
		contributor: { kind: "addon", id: "air_conditioning" },
		flow: "consume",
		roles: ["demand_flex"],
		generatedAt: NOW.toISOString(),
		validUntil: null,
		revision: 1,
		enabled: true,
		flexible: true,
		gridEligible: true,
		quality: Q,
		reasonDe: "Kein Climate-Bedarf.",
		details: {
			unitIndex: 1,
			unitName: "Wohnzimmer",
			unitEnabled: true,
			likelyActive: false,
			coolingHours: 0,
			heatingHours: 0,
			dehumidifyHours: 0,
			roomHumidityPct: 50,
			maxHumidityPct: 60,
			...over,
		},
		slots: [],
	} as unknown as PlanContribution;
}

function base(over: Partial<AssessmentBuildInput> = {}): AssessmentBuildInput {
	return {
		now: NOW,
		timezone: TZ,
		plan: emptyPlan(),
		plannerInput: planner(),
		contributions: [climateContrib(), climateContrib({ unitIndex: 2, unitName: "Josef" })],
		strategy: {
			schemaVersion: 1,
			generatedAtIso: NOW.toISOString(),
			battery: {
				status: "reserve_protected",
				labelDe: "Reserve geschützt",
				reasonDe: "voll",
				summaryDe: "Reserve geschützt · SOC 100 %",
				hasChargeAllocation: false,
				socPct: 100,
				nightReserveKwh: 3,
			},
			wallbox: {
				status: "waiting_for_vehicle",
				labelDe: "Wartet auf Fahrzeug",
				reasonDe: "getrennt",
				summaryDe: "Wartet auf Fahrzeug",
				hasChargeAllocation: false,
				connectedNow: false,
				deadlineIso: null,
			},
		},
		pvTodayKwh: 12,
		pvTomorrowKwh: 28,
		weatherTodayMinC: 15,
		weatherTodayMaxC: 24,
		weatherTomorrowMinC: 15,
		weatherTomorrowMaxC: 28,
		surplusW: 2500,
		priceNowCt: 18.8,
		gb: {
			enabled: true,
			active: false,
			ready: true,
			priceAllowed: false,
			blockReason: "price_below_min",
			requestedPowerW: 0,
			minPriceCt: 30,
			currentPriceCt: 18.8,
		},
		immersion: {
			boilerTempC: 67,
			bufferTempC: 62.3,
			targetTempC: 62.7,
			maxTempC: 63,
			boilerMinC: 45,
			hygieneDue: false,
			forced: false,
			autoTargetReached: true,
			requiredFlexKwh: 0.3,
			mode: "auto",
		},
		...over,
	};
}

describe("buildOperationalAssessment", () => {
	it("Produktionsbeispiel: voll, Ziel erreicht, Auto getrennt, GB preisgesperrt", () => {
		const a = buildOperationalAssessment(base());
		assert.match(a.ev.text, /kein Laden/i);
		assert.match(a.ev.text, /77/);
		assert.match(a.ev.text, /80/);
		assert.match(a.ev.next ?? "", /PV|neu bewertet|morgen/i);
		assert.match(a.immersion.text, /Zieltemperatur erreicht/);
		assert.doesNotMatch(a.immersion.text, /0,3 kWh/);
		assert.match(a.climate.units[0]!.cooling, /keine Kühlung/);
		assert.match(a.climate.units[0]!.dehumidify, /nicht erforderlich/);
		assert.equal(a.climate.units[0]!.heating, null);
		assert.match(a.battery.text, /100/);
		assert.match(a.battery.text, /Nachtreserve|eingespeist/);
		assert.match(a.gridBalance.text, /gesperrt/);
		assert.match(a.gridBalance.text, /Freigabegrenze/);
		assert.equal(a.gridBalance.status, "blocked");
		assert.match(a.forecast.text, /28/);
		assert.doesNotMatch(JSON.stringify(a), /mandatory|demand_model|expectedKwh=/);
	});

	it("EV Pflichtladung heute widerspricht nicht dem Text", () => {
		const a = buildOperationalAssessment(
			base({
				plan: emptyPlan([cell("wallbox", "2026-09-03T14:00:00.000Z", "2026-09-03T14:15:00.000Z")]),
				plannerInput: planner({
					wallbox: {
						...planner().wallbox!,
						requiredEnergyKwh: 8,
						energyGoalHard: true,
						connectedNow: true,
						vehicleSocPct: 40,
						targetSocPct: 80,
					},
				}),
			}),
		);
		assert.match(a.ev.text, /Pflichtladung|Ladefenster/);
		assert.doesNotMatch(a.ev.text, /kein Laden nötig/);
	});

	it("EV: zukünftige Preise unbekannt → keine Billiger-übermorgen-Behauptung", () => {
		const a = buildOperationalAssessment(
			base({
				pvTomorrowKwh: null,
				plannerInput: planner({
					wallbox: { ...planner().wallbox!, requiredEnergyKwh: 6, connectedNow: true, vehicleSocPct: 50 },
					prices: { slots: [], uncertainty: Q, freshness: fresh() },
				}),
			}),
		);
		assert.doesNotMatch(a.ev.text + (a.ev.next ?? ""), /übermorgen|billiger als morgen/i);
		assert.match(a.ev.next ?? "", /neu bewertet/);
	});

	it("EV: günstiger Preis morgen nur bei belastbarem Horizon", () => {
		const hours = Array.from({ length: 12 }, (_, i) => [i, 28] as [number, number]);
		const cheap = Array.from({ length: 12 }, (_, i) => [i, i === 2 ? 12 : 22] as [number, number]);
		const a = buildOperationalAssessment(
			base({
				pvTomorrowKwh: 8,
				plannerInput: planner({
					wallbox: { ...planner().wallbox!, requiredEnergyKwh: 5, connectedNow: true, vehicleSocPct: 55 },
					prices: {
						slots: [...priceDay("2026-09-03", hours), ...priceDay("2026-09-04", cheap)],
						uncertainty: Q,
						freshness: fresh(),
					},
				}),
			}),
		);
		assert.match(a.ev.next ?? "", /Günstigeres Fenster morgen/);
	});

	it("Heizstab Forced / Hygiene / Flex", () => {
		assert.match(buildOperationalAssessment(base({ immersion: { ...base().immersion, forced: true } })).immersion.text, /Zwang/);
		assert.match(
			buildOperationalAssessment(base({ immersion: { ...base().immersion, hygieneDue: true, autoTargetReached: false } }))
				.immersion.text,
			/Hygiene/,
		);
		const flex = buildOperationalAssessment(
			base({
				immersion: { ...base().immersion, autoTargetReached: false, bufferTempC: 50, targetTempC: 62, requiredFlexKwh: 2 },
			}),
		);
		assert.match(flex.immersion.text, /Flexibler|kein fahrbares Fenster/);
	});

	it("Climate Cooling / Pre-Cool / Dry / Heating disabled vs enabled", () => {
		const climateSlot = cell("climate", "2026-09-03T14:00:00.000Z", "2026-09-03T14:15:00.000Z", 800);
		climateSlot.consumerId = "air_conditioning.unit_1";
		const cool = buildOperationalAssessment(
			base({
				plan: emptyPlan([climateSlot]),
				contributions: [
					climateContrib({ likelyActive: true, coolingHours: 2.5, reasonDe: "aktueller Kühlbedarf" }),
				],
			}),
		);
		assert.match(cool.climate.units[0]!.cooling, /Kühlung heute vorgesehen/);

		const pre = buildOperationalAssessment(
			base({
				plan: emptyPlan([climateSlot]),
				contributions: [
					climateContrib({
						likelyActive: true,
						coolingHours: 1.2,
						reasonDe: "Raum nähert sich 26 °C — vorsichtiges Pre-Cooling",
					}),
				],
			}),
		);
		assert.match(pre.climate.units[0]!.cooling, /Pre-Cooling/);

		const dry = buildOperationalAssessment(
			base({
				plan: emptyPlan([climateSlot]),
				contributions: [
					climateContrib({
						likelyActive: true,
						dehumidifyHours: 1,
						coolingHours: 0,
						roomHumidityPct: 68,
						reasonDe: "aktueller Dry-Bedarf",
					}),
				],
			}),
		);
		assert.match(dry.climate.units[0]!.dehumidify, /68 %/);

		const heatOn = buildOperationalAssessment(
			base({
				contributions: [climateContrib({ heatSetpointC: 20, heatingHours: 0, likelyActive: false })],
			}),
		);
		assert.equal(heatOn.climate.units[0]!.heating, "Kein Climate-Heizbedarf.");

		const heatOff = buildOperationalAssessment(base());
		assert.equal(heatOff.climate.units[0]!.heating, null);
	});

	it("Batterie Hold / Entladung / GB aktiv vs Hard-Gate", () => {
		const hold = buildOperationalAssessment(
			base({
				strategy: {
					...base().strategy!,
					battery: { ...base().strategy!.battery, status: "hold", summaryDe: "Hold" },
				},
			}),
		);
		assert.match(hold.battery.text, /Halt/);

		const dis = buildOperationalAssessment(
			base({
				plannerInput: planner({ battery: { ...planner().battery, socPct: 70 } }),
				strategy: {
					...base().strategy!,
					battery: { ...base().strategy!.battery, status: "available_for_discharge", socPct: 70 },
				},
			}),
		);
		assert.match(dis.battery.text, /Entladung/);

		const gbOn = buildOperationalAssessment(
			base({ gb: { ...base().gb, active: true, priceAllowed: true, requestedPowerW: 800 } }),
		);
		assert.equal(gbOn.gridBalance.status, "active");
		assert.match(gbOn.gridBalance.text, /aktiv/);

		const blocked = buildOperationalAssessment(base());
		assert.equal(blocked.gridBalance.status, "blocked");

		const hard = buildOperationalAssessment(
			base({
				gb: {
					...base().gb,
					priceAllowed: true,
					ready: false,
					active: false,
					requestedPowerW: 0,
					blockReason: "mapping_stale",
				},
			}),
		);
		assert.equal(hard.gridBalance.status, "blocked");
		assert.match(hard.gridBalance.text, /technische Freigabe|gesperrt/i);

		const idleGb = buildOperationalAssessment(
			base({
				gb: {
					...base().gb,
					priceAllowed: true,
					ready: true,
					active: false,
					requestedPowerW: 0,
					blockReason: "",
				},
			}),
		);
		assert.equal(idleGb.gridBalance.status, "idle");
		assert.match(idleGb.gridBalance.text, /bereit|kein Abruf/i);
	});

	it("Heizstab Boiler-Min", () => {
		const a = buildOperationalAssessment(
			base({
				immersion: {
					...base().immersion,
					autoTargetReached: false,
					boilerTempC: 46,
					boilerMinC: 45,
					bufferTempC: 50,
					targetTempC: 62,
				},
			}),
		);
		assert.match(a.immersion.text, /nähert sich der Untergrenze/);
	});

	it("Konsistenz: keine Kühlung-Text wenn Cooling-Stunden geplant", () => {
		const climateSlot = cell("climate", "2026-09-03T14:00:00.000Z", "2026-09-03T16:00:00.000Z", 800);
		climateSlot.consumerId = "air_conditioning.unit_1";
		const a = buildOperationalAssessment(
			base({
				plan: emptyPlan([climateSlot]),
				contributions: [climateContrib({ likelyActive: true, coolingHours: 4 })],
			}),
		);
		assert.doesNotMatch(a.climate.units[0]!.cooling, /keine Kühlung/);
		assert.match(a.climate.units[0]!.cooling, /Kühlung heute vorgesehen/);
	});

	it("Konsistenz: Kühlbedarf ohne Plan-Allocation nicht als geplant ausgeben", () => {
		const a = buildOperationalAssessment(
			base({
				contributions: [climateContrib({ likelyActive: true, coolingHours: 4 })],
			}),
		);
		assert.match(a.climate.units[0]!.cooling, /kein Kühlfenster im Plan/);
		assert.doesNotMatch(a.climate.units[0]!.cooling, /Kühlung heute vorgesehen/);
	});

	it("EV getrennt mit Restbedarf", () => {
		const a = buildOperationalAssessment(
			base({
				pvTomorrowKwh: 22,
				plannerInput: planner({
					wallbox: {
						...planner().wallbox!,
						connectedNow: false,
						vehicleSocPct: 55,
						targetSocPct: 80,
						requiredEnergyKwh: 12,
					},
				}),
			}),
		);
		assert.match(a.ev.text, /nicht angesteckt/);
		assert.doesNotMatch(a.ev.text, /kein Laden nötig/);
		assert.match(a.ev.next ?? "", /PV|neu bewertet|Auto da/i);
	});

	it("Konsistenz: heute nicht laden nur ohne heutigen Wallbox-Slot", () => {
		const idle = buildOperationalAssessment(base());
		assert.match(idle.ev.text, /kein Laden/);
		const planned = buildOperationalAssessment(
			base({
				plan: emptyPlan([cell("wallbox", "2026-09-03T15:00:00.000Z", "2026-09-03T15:15:00.000Z")]),
			}),
		);
		assert.doesNotMatch(planned.ev.text, /kein Laden nötig/);
	});

	it("Nutzersprache ohne Entwicklerfelder", () => {
		const de = formatOperationalAssessmentDe(buildOperationalAssessment(base()));
		assert.match(de, /EMS-Einschätzung/);
		assert.match(de, /Auto:/);
		assert.match(de, /Heizstab:/);
		assert.doesNotMatch(de, /mandatory=|demand_model|expectedKwh=|ready=false/);
	});
});
