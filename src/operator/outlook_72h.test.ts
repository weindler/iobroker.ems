import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allocateUnifiedDayPlan } from "./daily_plan/unified/allocate";
import { buildSlots, golden001Input } from "./daily_plan/unified/fixtures";
import type { UnifiedDayPlannerInput } from "./daily_plan/unified/types";
import { buildOperatorOutlook72h, formatOperatorOutlook72hDe } from "./outlook_72h";

const NOW = new Date("2026-09-03T00:00:00.000Z");

function input80h(withMissingPv = false): UnifiedDayPlannerInput {
	const base = golden001Input();
	const slots = buildSlots(NOW.toISOString(), 80);
	return {
		...base,
		time: {
			...base.time,
			nowIso: NOW.toISOString(),
			timezone: "UTC",
			horizonStartIso: slots[0].startIso,
			horizonEndIso: slots[slots.length - 1].endIso,
			slots,
		},
		pv: {
			...base.pv,
			slots: slots.map((slot, index) => ({
				slot,
				forecastPowerW: withMissingPv && index === 100 ? null : 1000,
				observedPowerW: null,
				energyKwh: withMissingPv && index === 100 ? null : 0.25,
			})),
		},
		houseLoad: {
			...base.houseLoad,
			slots: slots.map((slot) => ({
				slot,
				forecastPowerW: 500,
				observedPowerW: null,
				energyKwh: 0.125,
			})),
		},
		prices: {
			...base.prices,
			slots: slots.map((slot) => ({
				slot,
				importCtPerKwh: 20,
				exportCtPerKwh: 8,
				gridImportAllowed: true,
			})),
		},
		thermal: null,
		wallbox: null,
		climate: null,
		otherFlex: [],
	};
}

function multiDayThermalInput(args: {
	todayPvW: number;
	tomorrowPvW: number;
	dayAfterPvW: number;
	emptyAtIso: string;
}): UnifiedDayPlannerInput {
	const input = input80h();
	const startMs = NOW.getTime();
	input.pv.slots = input.time.slots.map((slot) => {
		const slotMs = Date.parse(slot.startIso);
		const day = Math.floor((slotMs - startMs) / 86_400_000);
		const hour = new Date(slotMs).getUTCHours();
		const daylight = hour >= 9 && hour < 15;
		const powerW = !daylight
			? 0
			: day === 0
				? args.todayPvW
				: day === 1
					? args.tomorrowPvW
					: day === 2
						? args.dayAfterPvW
						: 0;
		return {
			slot,
			forecastPowerW: powerW,
			observedPowerW: null,
			energyKwh: powerW / 4000,
		};
	});
	input.houseLoad.slots = input.time.slots.map((slot) => ({
		slot,
		forecastPowerW: 500,
		observedPowerW: null,
		energyKwh: 0.125,
	}));
	input.pv.expectedDayEnergyKwh = input.pv.slots
		.filter((slot) => slot.slot.startIso < "2026-09-04T00:00:00.000Z")
		.reduce((sum, slot) => sum + (slot.energyKwh ?? 0), 0);
	input.battery = {
		...input.battery,
		socPct: 100,
		minSocPct: 10,
		reserveSocPct: 10,
		endSocTargetPct: 100,
		requiredChargeEnergyKwh: 0,
		passiveBatteryEnergyAvailable: false,
	};
	input.thermal = {
		bufferTempC: 58,
		boilerTempC: 60,
		minTempC: 50,
		boilerMinTempC: 50,
		maxTempC: 65,
		dayTargetTempC: 63,
		availablePowerW: 1700,
		minPowerW: 1700,
		headroomEnergyKwh: 0.85,
		estimatedEmptyAtIso: args.emptyAtIso,
		deadlineIso: args.emptyAtIso,
		emptyAtSource: "estimated",
		boilerEmptyAtUsable: false,
		hygieneMandatoryKwh: 0,
		hygieneDue: false,
		nightBridgeActive: false,
		mayUseBatteryForImmersion: false,
		coolingRateCPerH: 0.15,
		minimumRuntimeSec: 300,
		hysteresisK: 2,
		reheatHysteresisActive: false,
		uncertainty: input.pv.uncertainty,
		freshness: input.pv.freshness,
	};
	return input;
}

describe("operator rolling 72 h outlook", () => {
	it("caps the authoritative horizon at 72 h and exposes complete per-day data", () => {
		const input = input80h();
		const plan = allocateUnifiedDayPlan(input);
		const outlook = buildOperatorOutlook72h({ now: NOW, timezone: "UTC", plan, plannerInput: input });

		assert.equal(outlook.status, "ready");
		assert.equal(outlook.complete, true);
		assert.equal(outlook.coveredHours, 72);
		assert.equal(outlook.horizonEndIso, "2026-09-06T00:00:00.000Z");
		assert.deepEqual(outlook.days.map((day) => day.dateKey), ["2026-09-03", "2026-09-04", "2026-09-05"]);
		assert.equal(outlook.days[0].expectedPvKwh, 24);
		assert.equal(outlook.days[0].expectedHouseLoadKwh, 12);
		assert.equal(outlook.days[0].priceCtPerKwh.complete, true);
		assert.match(formatOperatorOutlook72hDe(outlook), /72-h-Ausblick/);
	});

	it("keeps a partially missing PV day null instead of fabricating a full sum", () => {
		const input = input80h(true);
		const plan = allocateUnifiedDayPlan(input);
		const outlook = buildOperatorOutlook72h({ now: NOW, timezone: "UTC", plan, plannerInput: input });

		assert.equal(outlook.days[1].expectedPvKwh, null);
		assert.equal(outlook.days[1].pvKnownSlots, 95);
		assert.equal(outlook.status, "partial");
		assert.equal(outlook.complete, false);
		assert.ok(outlook.reasonCodes.includes("forecast_values_incomplete"));
	});

	it("counts real slot coverage and reports a gap as partial", () => {
		const input = input80h();
		input.time.slots = input.time.slots.filter((_, index) => index !== 120);
		const plan = allocateUnifiedDayPlan(input);
		const outlook = buildOperatorOutlook72h({ now: NOW, timezone: "UTC", plan, plannerInput: input });
		assert.equal(outlook.coveredHours, 71.75);
		assert.equal(outlook.status, "partial");
		assert.ok(outlook.reasonCodes.includes("forecast_horizon_shorter_than_72h"));
	});

	it("reports unavailable without inventing a plan", () => {
		const outlook = buildOperatorOutlook72h({
			now: NOW,
			timezone: "Europe/Berlin",
			plan: null,
			plannerInput: null,
		});
		assert.equal(outlook.status, "unavailable");
		assert.equal(outlook.coveredHours, 0);
		assert.deepEqual(outlook.days, []);
		assert.deepEqual(outlook.decisions, []);
	});

	it("waits through a weak tomorrow for the strong day-after PV window and explains why", () => {
		const input = multiDayThermalInput({
			todayPvW: 2500,
			tomorrowPvW: 900,
			dayAfterPvW: 5000,
			emptyAtIso: "2026-09-05T18:00:00.000Z",
		});
		const plan = allocateUnifiedDayPlan(input);
		const thermal = plan.allocations.filter((allocation) => allocation.kind === "immersion_heater");
		assert.ok(thermal.length > 0, "starkes PV-Fenster an Tag 3 muss als Soft-Wärmeslot nutzbar sein");
		assert.ok(
			thermal.every((allocation) => allocation.slot.startIso.startsWith("2026-09-05")),
			thermal.map((allocation) => allocation.slot.startIso).join(", "),
		);
		const outlook = buildOperatorOutlook72h({ now: NOW, timezone: "UTC", plan, plannerInput: input });
		const decision = outlook.decisions.find((entry) => entry.kind === "immersion_heater");
		assert.equal(decision?.state, "deferred");
		assert.match(decision?.explanationDe ?? "", /bessere PV-Fenster/);
		assert.match(formatOperatorOutlook72hDe(outlook), /Übermorgen/);
	});

	it("stores heat today when the following days are weak", () => {
		const input = multiDayThermalInput({
			todayPvW: 5000,
			tomorrowPvW: 200,
			dayAfterPvW: 200,
			emptyAtIso: "2026-09-04T06:00:00.000Z",
		});
		input.thermal = { ...input.thermal!, headroomEnergyKwh: 1.7 };
		const plan = allocateUnifiedDayPlan(input);
		const thermal = plan.allocations.filter((allocation) => allocation.kind === "immersion_heater");
		assert.ok(thermal.length > 0);
		assert.ok(
			thermal.every((allocation) => allocation.slot.startIso.startsWith("2026-09-03")),
			thermal.map((allocation) => allocation.slot.startIso).join(", "),
		);
	});

	it("states that an EV already at target needs no charge", () => {
		const input = input80h();
		input.battery = { ...input.battery, socPct: 100, requiredChargeEnergyKwh: 0 };
		input.wallbox = {
			connectedNow: true,
			presenceWindows: [{
				available: true,
				status: "available",
				source: "explicit",
				hard: true,
				startIso: input.time.horizonStartIso,
				endIso: input.time.horizonEndIso,
			}],
			presenceHardConstraint: true,
			vehicleProfileId: "weekend-car",
			vehicleSocPct: 80,
			socSource: "direct",
			fallbackEnergyNeedKwh: null,
			vehicleCapacityKwh: 60,
			targetSocPct: 80,
			requiredEnergyKwh: 0,
			deadlineIso: null,
			energyGoalHard: false,
			minChargePowerW: 1380,
			maxChargePowerW: 11000,
			chargeLossFactor: 1,
			evccExecutionMaster: true,
			managementMode: "ems_candidate",
			hardRequiredEnergyKwh: 0,
			targetEnergyKwh: 0,
			uncertainty: input.pv.uncertainty,
			freshness: input.pv.freshness,
		};
		const plan = allocateUnifiedDayPlan(input);
		assert.equal(plan.allocations.some((allocation) => allocation.kind === "wallbox"), false);
		const outlook = buildOperatorOutlook72h({ now: NOW, timezone: "UTC", plan, plannerInput: input });
		const decision = outlook.decisions.find((entry) => entry.kind === "wallbox");
		assert.equal(decision?.state, "not_needed");
		assert.match(decision?.explanationDe ?? "", /Ziel.*erreicht/);
	});

	it("places a small EV need into the best available PV window instead of charging immediately", () => {
		const input = input80h();
		input.pv.slots = input.time.slots.map((slot) => {
			const inBestWindow = slot.startIso >= "2026-09-04T10:00:00.000Z" && slot.startIso < "2026-09-04T11:00:00.000Z";
			const powerW = inBestWindow ? 5000 : 100;
			return { slot, forecastPowerW: powerW, observedPowerW: null, energyKwh: powerW / 4000 };
		});
		input.houseLoad.slots = input.time.slots.map((slot) => ({
			slot,
			forecastPowerW: 500,
			observedPowerW: null,
			energyKwh: 0.125,
		}));
		input.battery = {
			...input.battery,
			socPct: 100,
			requiredChargeEnergyKwh: 0,
			passiveBatteryEnergyAvailable: false,
		};
		input.wallbox = {
			connectedNow: true,
			presenceWindows: [{
				available: true,
				status: "available",
				source: "explicit",
				hard: true,
				startIso: input.time.horizonStartIso,
				endIso: input.time.horizonEndIso,
			}],
			presenceHardConstraint: true,
			vehicleProfileId: "weekend-car",
			vehicleSocPct: 78,
			socSource: "direct",
			fallbackEnergyNeedKwh: null,
			vehicleCapacityKwh: 50,
			targetSocPct: 80,
			requiredEnergyKwh: 1,
			deadlineIso: null,
			energyGoalHard: false,
			minChargePowerW: 1380,
			maxChargePowerW: 11000,
			chargeLossFactor: 1,
			evccExecutionMaster: true,
			evccChargeMode: "pv",
			managementMode: "ems_candidate",
			hardRequiredEnergyKwh: 0,
			targetEnergyKwh: 1,
			uncertainty: input.pv.uncertainty,
			freshness: input.pv.freshness,
		};
		const plan = allocateUnifiedDayPlan(input);
		const wallbox = plan.allocations.filter((allocation) => allocation.kind === "wallbox");
		assert.ok(wallbox.length > 0);
		assert.ok(
			wallbox.every(
				(allocation) =>
					allocation.energySource === "pv_surplus" &&
					allocation.slot.startIso >= "2026-09-04T10:00:00.000Z" &&
					allocation.slot.startIso < "2026-09-04T11:00:00.000Z",
			),
			wallbox.map((allocation) => `${allocation.slot.startIso}:${allocation.energySource}`).join(", "),
		);
		assert.ok(wallbox.reduce((sum, allocation) => sum + allocation.allocatedEnergyKwh, 0) >= 0.99);
		const outlook = buildOperatorOutlook72h({ now: NOW, timezone: "UTC", plan, plannerInput: input });
		const decision = outlook.decisions.find((entry) => entry.kind === "wallbox");
		assert.equal(decision?.state, "deferred");
		assert.match(decision?.explanationDe ?? "", /aus PV-Überschuss/);
	});

	it("pre-shifts climate only for a forecasted need and keeps it before Hard-Off", () => {
		const input = input80h();
		input.pv.slots = input.time.slots.map((slot) => {
			const goodWindow = slot.startIso >= "2026-09-03T02:00:00.000Z" && slot.startIso < "2026-09-03T03:00:00.000Z";
			const powerW = goodWindow ? 3000 : 100;
			return { slot, forecastPowerW: powerW, observedPowerW: null, energyKwh: powerW / 4000 };
		});
		input.houseLoad.slots = input.time.slots.map((slot) => ({
			slot,
			forecastPowerW: 500,
			observedPowerW: null,
			energyKwh: 0.125,
		}));
		input.battery = {
			...input.battery,
			socPct: 10,
			minSocPct: 10,
			reserveSocPct: 10,
			requiredChargeEnergyKwh: 0,
			passiveBatteryEnergyAvailable: false,
		};
		input.climate = {
			units: [{
				unitId: "air_conditioning.unit_1",
				label: "Wohnzimmer",
				roomTempC: 24,
				comfortMinC: null,
				comfortMaxC: 25,
				targetTempC: 24,
				mandatoryComfort: false,
				expectedEnergyKwh: 0,
				typicalPowerW: 850,
				maxShiftHours: 3,
				hardStopMs: Date.parse("2026-09-03T04:00:00.000Z"),
				demandModel: "predictive",
				predictiveConfidence: 0.8,
				predictedCrossingAtIso: "2026-09-03T03:30:00.000Z",
				uncertainty: input.pv.uncertainty,
			}],
			freshness: input.pv.freshness,
		};
		const withoutNeed = allocateUnifiedDayPlan(input);
		assert.equal(withoutNeed.allocations.some((allocation) => allocation.kind === "climate"), false);

		input.climate.units[0] = { ...input.climate.units[0]!, expectedEnergyKwh: 0.85 };
		const withNeed = allocateUnifiedDayPlan(input);
		const climate = withNeed.allocations.filter((allocation) => allocation.kind === "climate");
		assert.ok(climate.length > 0);
		assert.ok(climate.every((allocation) => Date.parse(allocation.slot.startIso) < Date.parse("2026-09-03T04:00:00.000Z")));
		const outlook = buildOperatorOutlook72h({ now: NOW, timezone: "UTC", plan: withNeed, plannerInput: input });
		const decision = outlook.decisions.find((entry) => entry.kind === "climate");
		assert.match(decision?.explanationDe ?? "", /prädiktivem Raum-\/Wetter-Learning/);
		assert.match(decision?.explanationDe ?? "", /Hard-Off/);
	});
});
