/**
 * Joint Unified Energy Optimization — Abnahmeszenarien A–G (Beta 08.08.2026).
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../../quality";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildSlots, golden001Input } from "./fixtures";
import { buildProductSummaryDe, buildUnifiedDayAgendaDe } from "../../../beta/product_summary";
import { buildImmersionHeaterContributions } from "../../contributions/flexible/immersion_heater";
import { immersionDeviceConfigFromAdapter } from "../../../addons/immersion_heater/device_config";
import { plannerModePolicyFromGlobalMode } from "../../../planner/mode_policy";
import type { UnifiedDayPlannerInput } from "./types";
import { REASON } from "./reason_codes";

const TZ = "Europe/Berlin";
const Q = operatorQuality("valid", "joint-fixture", 85);
const FRESH = { observedAtIso: "2026-08-08T08:30:00.000Z", ageSec: 10, quality: Q };

function sumKind(
	plan: ReturnType<typeof allocateUnifiedDayPlan>,
	kind: string,
	pred?: (a: (typeof plan.allocations)[0]) => boolean,
): number {
	return plan.allocations
		.filter((a) => a.kind === kind && (!pred || pred(a)))
		.reduce((s, a) => a.allocatedEnergyKwh + s, 0);
}

function energyBeforeDeadline(
	plan: ReturnType<typeof allocateUnifiedDayPlan>,
	kind: string,
	deadlineIso: string,
): number {
	const dead = Date.parse(deadlineIso);
	return plan.allocations
		.filter((a) => a.kind === kind && Date.parse(a.slot.startIso) < dead)
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

/** Szenario A — realer Beta-Fall 08.08.2026 ~10:30 lokal. */
function scenarioAInput(overrides: Partial<UnifiedDayPlannerInput> = {}): UnifiedDayPlannerInput {
	const nowIso = "2026-08-08T08:30:00.000Z"; // 10:30 CEST
	const emptyAt = "2026-08-08T15:25:00.000Z"; // 17:25 CEST
	const slots = buildSlots(nowIso, 48); // 2 Tage — reicht für Tomorrow-PV + Nachtreserve; Horizon >24h
	const base = golden001Input();
	base.time = {
		...base.time,
		nowIso,
		timezone: TZ,
		slots,
		horizonStartIso: slots[0]!.startIso,
		horizonEndIso: slots[slots.length - 1]!.endIso,
	};
	// PV today strong midday, weaker late afternoon; tomorrow similar
	base.pv.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		const day0 = Date.parse(s.startIso) < Date.parse("2026-08-09T00:00:00.000Z");
		let power = 0;
		if (day0) {
			if (h >= 8 && h < 14) power = 4200;
			else if (h >= 14 && h < 16) power = 1800;
			else if (h >= 6 && h < 18) power = 900;
		} else if (h >= 7 && h < 16) {
			power = 3800;
		}
		return {
			slot: s,
			forecastPowerW: power,
			observedPowerW: null,
			energyKwh: (power / 1000) * 0.25,
		};
	});
	base.pv.expectedDayEnergyKwh = 43.6;
	base.pv.previousExpectedDayEnergyKwh = null;
	base.houseLoad.slots = slots.map((s) => ({
		slot: s,
		forecastPowerW: 900,
		observedPowerW: null,
		energyKwh: 0.225,
	}));
	base.houseLoad.expectedDayEnergyKwh = 22.3;
	base.prices.slots = slots.map((s) => {
		const h = new Date(s.startIso).getUTCHours();
		const night = h >= 22 || h < 5;
		return {
			slot: s,
			importCtPerKwh: night ? 12 : 28,
			exportCtPerKwh: 8,
			gridImportAllowed: true,
		};
	});
	base.battery = {
		...base.battery,
		socPct: 55,
		usableCapacityKwh: 10,
		minSocPct: 10,
		reserveSocPct: 10,
		nightReserveKwh: 2.5,
		maxChargePowerW: 4600,
		requiredChargeEnergyKwh: null,
		endSocTargetPct: null,
		chargeDeadlineIso: null,
		gridChargeAllowed: true,
		uncertainty: Q,
		freshness: FRESH,
	};
	base.thermal = {
		bufferTempC: 49,
		minTempC: 44,
		maxTempC: 63,
		dayTargetTempC: 58,
		availablePowerW: 1700,
		minPowerW: 1700,
		headroomEnergyKwh: 3.8,
		estimatedEmptyAtIso: emptyAt,
		deadlineIso: emptyAt,
		emptyAtSource: "estimated",
		nightBridgeActive: true,
		coolingRateCPerH: 0.7,
		minimumRuntimeSec: 300,
		hysteresisK: 5,
		reheatHysteresisActive: true,
		uncertainty: operatorQuality("degraded", "estimated empty_at", 55),
		freshness: FRESH,
	};
	base.climate = {
		units: [
			{
				unitId: "air_conditioning.unit_1",
				label: "wohn",
				roomTempC: 24.5,
				comfortMinC: null,
				comfortMaxC: 26,
				targetTempC: 25.5,
				mandatoryComfort: false,
				expectedEnergyKwh: 3.5,
				typicalPowerW: 900,
				maxShiftHours: 3,
				uncertainty: Q,
			},
		],
		freshness: FRESH,
	};
	base.wallbox = null;
	base.globalMode = "balanced";
	return { ...base, ...overrides };
}

describe("JOINT-A beta thermal preload vs climate vs night reserve", () => {
	it("plans thermal preload before empty_at, keeps night reserve signal, funds flex climate", () => {
		const input = scenarioAInput();
		const plan = allocateUnifiedDayPlan(input);
		const emptyAt = input.thermal!.deadlineIso!;
		const ihBefore = energyBeforeDeadline(plan, "immersion_heater", emptyAt);
		const ihTotal = sumKind(plan, "immersion_heater");
		const climate = sumKind(plan, "climate");
		const batHeat = sumKind(
			plan,
			"immersion_heater",
			(a) => a.energySource === "battery" || a.energySource === "mixed",
		);

		assert.ok(ihTotal > 1.5, `expected thermal plan, got ${ihTotal}`);
		assert.ok(ihBefore > 1.0, `thermal must preload before empty_at, before=${ihBefore}`);
		assert.equal(batHeat, 0, "no battery heat for thermal");
		assert.ok(climate > 0.5, `flex climate should get surplus, got ${climate}`);
		assert.ok(plan.reasonCodes.includes(REASON.BATTERY_NIGHT_RESERVE));
		assert.ok(plan.reasonCodes.includes(REASON.THERMAL_DEADLINE_PV_WINDOW));
		assert.ok(plan.constraints.some((c) => c.id === "battery.night_reserve"));
		assert.ok(plan.constraints.some((c) => c.id === "thermal.deadline"));

		const agenda = buildUnifiedDayAgendaDe(plan);
		assert.ok(agenda.some((l) => /Heizstab|thermisch/i.test(l)), agenda.join(" | "));
		assert.ok(agenda.some((l) => /Nachtreserve|2,?5/i.test(l)), agenda.join(" | "));

		const summary = buildProductSummaryDe(plan, { batteryStartSocPct: 55 });
		assert.match(summary, /Plan:/);
		assert.match(summary, /43,6/);
		// readable dump for Abschlussbericht
		assert.ok(summary.length > 40);
	});
});

describe("JOINT-B tomorrow weak PV → stronger thermal headroom still scheduled", () => {
	it("still preloads when tomorrow PV is weak (contribution raises target upstream)", () => {
		const input = scenarioAInput();
		input.thermal = {
			...input.thermal!,
			dayTargetTempC: 63,
			headroomEnergyKwh: 5.5,
			emptyAtSource: "learned",
		};
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(sumKind(plan, "immersion_heater") > 2.5);
		assert.ok(energyBeforeDeadline(plan, "immersion_heater", input.thermal!.deadlineIso!) > 1.5);
	});
});

describe("JOINT-C vehicle deadline competes with thermal", () => {
	it("covers vehicle deadline while still allowing thermal PV window", () => {
		const input = scenarioAInput();
		const deadline = "2026-08-09T05:00:00.000Z";
		input.wallbox = {
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					status: "available",
					source: "explicit",
					hard: true,
					startIso: input.time.horizonStartIso,
					endIso: input.time.horizonEndIso,
				},
			],
			presenceHardConstraint: true,
			vehicleProfileId: "car",
			vehicleSocPct: 35,
			socSource: "direct",
			fallbackEnergyNeedKwh: null,
			vehicleCapacityKwh: 60,
			targetSocPct: 80,
			requiredEnergyKwh: 12,
			deadlineIso: deadline,
			energyGoalHard: true,
			minChargePowerW: 1380,
			maxChargePowerW: 11000,
			chargeLossFactor: 1,
			evccExecutionMaster: true,
			uncertainty: Q,
			freshness: FRESH,
		};
		const plan = allocateUnifiedDayPlan(input);
		const wb = sumKind(plan, "wallbox");
		const ih = sumKind(plan, "immersion_heater");
		assert.ok(wb > 8, `vehicle need largely covered, got ${wb}`);
		assert.ok(ih > 0.5, `thermal still gets some PV, got ${ih}`);
		const goal = plan.goalStatuses.find((g) => g.consumerId === "wallbox");
		assert.ok(goal?.met !== false);
	});
});

describe("JOINT-D weak PV + cheap night grid for battery reserve", () => {
	it("may grid-charge toward night reserve when allowed and deficit", () => {
		const input = scenarioAInput();
		input.pv.slots = input.pv.slots.map((s) => ({
			...s,
			forecastPowerW: 200,
			energyKwh: 0.05,
		}));
		input.pv.expectedDayEnergyKwh = 4;
		input.battery = {
			...input.battery,
			socPct: 12,
			nightReserveKwh: 2.5,
			requiredChargeEnergyKwh: 3,
			chargeDeadlineIso: "2026-08-09T06:00:00.000Z",
			gridChargeAllowed: true,
		};
		input.thermal = { ...input.thermal!, headroomEnergyKwh: 0.5 };
		const plan = allocateUnifiedDayPlan(input);
		const gridBat = sumKind(plan, "battery_charge", (a) => a.energySource === "grid");
		assert.ok(gridBat > 0.5, `expected grid battery charge, got ${gridBat}`);
		assert.ok(
			plan.reasonCodes.includes(REASON.BATTERY_NIGHT_RESERVE) ||
				plan.reasonCodes.includes(REASON.BATTERY_RESERVE_PROTECTED),
		);
	});
});

describe("JOINT-E battery nearly empty — no thermal from battery", () => {
	it("does not allocate immersion from battery when SOC low", () => {
		const input = scenarioAInput();
		input.battery = { ...input.battery, socPct: 8, nightReserveKwh: 2.5 };
		const plan = allocateUnifiedDayPlan(input);
		const batHeat = sumKind(
			plan,
			"immersion_heater",
			(a) => a.energySource === "battery" || a.energySource === "mixed",
		);
		assert.equal(batHeat, 0);
		assert.ok(sumKind(plan, "immersion_heater") > 0.5);
	});
});

describe("JOINT-F battery full + high PV surplus → thermal absorbs", () => {
	it("routes surplus to thermal when battery near full", () => {
		const input = scenarioAInput();
		input.battery = { ...input.battery, socPct: 94, nightReserveKwh: 2.5 };
		input.thermal = { ...input.thermal!, headroomEnergyKwh: 4 };
		const plan = allocateUnifiedDayPlan(input);
		const ih = sumKind(plan, "immersion_heater");
		const batCharge = sumKind(plan, "battery_charge");
		assert.ok(ih > 2, `thermal should absorb surplus, got ${ih}`);
		assert.ok(ih + 0.5 >= batCharge, `thermal (${ih}) should dominate near-full battery charge (${batCharge})`);
		assert.ok(energyBeforeDeadline(plan, "immersion_heater", input.thermal!.deadlineIso!) > 1.5);
	});
});

describe("JOINT-G mandatory climate comfort now", () => {
	it("does not postpone mandatory comfort for later PV", () => {
		const input = scenarioAInput();
		input.climate = {
			units: [
				{
					unitId: "air_conditioning.unit_1",
					label: "wohn",
					roomTempC: 27,
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
		const climate = plan.allocations.filter((a) => a.kind === "climate");
		assert.ok(climate.length > 0);
		const first = climate[0]!;
		assert.ok(Date.parse(first.slot.startIso) <= Date.parse(input.time.nowIso) + 2 * 3600_000);
	});
});

describe("JOINT contribution: hysteresis must not zero planning demand", () => {
	it("publishes headroom with runtime-only hysteresis flag", () => {
		const [, flex] = buildImmersionHeaterContributions({
			now: new Date("2026-08-08T08:30:00.000Z"),
			addonEnabled: true,
			governanceEnabled: true,
			globalModeOff: false,
			modePolicy: plannerModePolicyFromGlobalMode("balanced"),
			config: immersionDeviceConfigFromAdapter({
				ih_stage_count: 1,
				ih_stage_1_set_state: "relay.0.heater",
				ih_stage_1_nominal_power_w: 1700,
				ih_buffer_temp_c_target: "sensor.0.temp",
				ih_buffer_temp_c_enabled: true,
				ih_temperature_hysteresis_k: 5,
				ih_planning_min_temp_c: 44,
				ih_planning_max_temp_c: 63,
			}),
			bufferTempC: 49,
			thermalMode: "auto",
			fault: false,
			lockout: false,
			relayMapped: true,
			pvTodayKwh: 43.6,
			pvTomorrowKwh: 41.8,
			pvBiasStatus: "ready",
			forecastModeEnabled: true,
			aiOptimizationAllowed: false,
			autoTargetReached: true,
			timezone: TZ,
			thermalLearning: {
				status: "degraded",
				health: "degraded",
				samples: 0,
				coolingRateCPerHAvg: 0.7,
				coolingConstantPerH: null,
				coolingAsymptoteC: null,
				estimatedRemainingHours: 7,
				estimatedEmptyAt: "2026-08-08T15:25:00.000Z",
				currentDayTypeRuntimeHoursMedian: null,
				reasonDe: "estimated",
			},
		});
		assert.equal(flex.enabled, true);
		assert.ok((flex.details.requiredEnergyKwh as number) > 0);
		assert.equal(flex.deadlineIso, "2026-08-08T15:25:00.000Z");
		assert.equal(flex.details.emptyAtSource, "estimated");
		assert.equal(flex.details.reheatHysteresisRuntimeOnly, true);
	});
});

describe("JOINT horizon remains multi-day", () => {
	it("keeps horizon beyond 24h when input has multi-day slots", () => {
		const input = scenarioAInput();
		assert.ok(input.time.slots.length >= 96); // 24h
		const plan = allocateUnifiedDayPlan(input);
		const horizonMs = Date.parse(plan.horizonEndIso) - Date.parse(plan.horizonStartIso);
		assert.ok(horizonMs >= 24 * 3600_000);
	});
});
