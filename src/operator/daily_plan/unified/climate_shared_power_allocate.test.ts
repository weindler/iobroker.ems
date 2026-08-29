import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
	hardPvConsumersFromInput,
	climateSharedGroupElectricalKwh,
	energyFromPowerW,
} from "./score_allocate.js";
import type { UnifiedDayPlannerInput, UnifiedClimateUnitInput, UnifiedAllocationCell } from "./types.js";
import { operatorQuality } from "../../quality.js";

function fresh() {
	return {
		observedAtIso: "2026-08-29T12:00:00.000Z",
		ageSec: 0,
		quality: operatorQuality("valid", "ok"),
	};
}

function baseInput(units: UnifiedClimateUnitInput[]): UnifiedDayPlannerInput {
	const start = Date.parse("2026-08-29T12:00:00.000Z");
	const slots = Array.from({ length: 4 }, (_, i) => {
		const s = new Date(start + i * 15 * 60_000).toISOString();
		const e = new Date(start + (i + 1) * 15 * 60_000).toISOString();
		return { startIso: s, endIso: e };
	});
	return {
		schemaVersion: 1,
		planIntent: "unified_day",
		time: {
			nowIso: slots[0]!.startIso,
			timezone: "Europe/Vienna",
			horizonStartIso: slots[0]!.startIso,
			horizonEndIso: slots[slots.length - 1]!.endIso,
			slotMinutes: 15,
			slots,
			freshness: fresh(),
		},
		globalMode: "balanced",
		pv: {
			slots: slots.map((slot) => ({
				slot,
				forecastPowerW: 5000,
				observedPowerW: null,
				energyKwh: energyFromPowerW(5000),
			})),
			expectedDayEnergyKwh: 20,
			previousExpectedDayEnergyKwh: null,
			biasCorrected: false,
			biasPct: null,
			uncertainty: operatorQuality("valid", "ok"),
			freshness: fresh(),
		},
		houseLoad: {
			slots: slots.map((slot) => ({
				slot,
				forecastPowerW: 400,
				observedPowerW: null,
				energyKwh: energyFromPowerW(400),
			})),
			expectedDayEnergyKwh: 5,
			uncertainty: operatorQuality("valid", "ok"),
			freshness: fresh(),
		},
		prices: {
			slots: slots.map((slot) => ({
				slot,
				importCtPerKwh: 20,
				exportCtPerKwh: 5,
				gridImportAllowed: true,
			})),
			uncertainty: operatorQuality("valid", "ok"),
			freshness: fresh(),
		},
		battery: {
			socPct: 60,
			usableCapacityKwh: 10,
			minSocPct: 10,
			maxSocPct: 100,
			maxChargePowerW: 3000,
			maxDischargePowerW: 3000,
			chargeEfficiency: 0.95,
			dischargeEfficiency: 0.95,
			allowedModes: ["charge", "discharge"],
			reserveSocPct: 20,
			nightReserveKwh: null,
			profileId: "test",
			dischargeLiveSupported: true,
			passiveBatteryEnergyAvailable: true,
			requiredChargeEnergyKwh: 0,
			endSocTargetPct: null,
			chargeDeadlineIso: null,
			gridChargeAllowed: false,
			uncertainty: operatorQuality("valid", "ok"),
			freshness: fresh(),
		},
		wallbox: null,
		thermal: null,
		climate: { units, freshness: fresh() },
		otherFlex: [],
		contributionRevision: 1,
	};
}

function unit(
	id: string,
	typicalPowerW: number,
	sharedPowerGroupId: string | null,
	over: Partial<UnifiedClimateUnitInput> = {},
): UnifiedClimateUnitInput {
	return {
		unitId: id,
		label: id,
		roomTempC: 28,
		comfortMinC: null,
		comfortMaxC: 24,
		targetTempC: 25,
		mandatoryComfort: true,
		expectedEnergyKwh: 2,
		typicalPowerW,
		maxShiftHours: 0,
		uncertainty: operatorQuality("valid", "ok"),
		sharedPowerGroupId,
		...over,
	};
}

describe("climate sharedPowerGroupId — electrical allocate once", () => {
	it("beide Units outdoor_1: Hard-PV-Bound zählt Gruppe nur einmal (nicht 850+700)", () => {
		const input = baseInput([
			unit("air_conditioning.unit_1", 850, "outdoor_1"),
			unit("air_conditioning.unit_2", 700, "outdoor_1"),
		]);
		const bound = hardPvConsumersFromInput(input);
		assert.equal(bound.length, 1);
		assert.equal(bound[0]!.maxPowerW, 850);
	});

	it("verschiedene Gruppen bleiben getrennt (Summe erlaubt)", () => {
		const input = baseInput([
			unit("air_conditioning.unit_1", 850, "outdoor_1"),
			unit("air_conditioning.unit_3", 600, "outdoor_2"),
		]);
		const bound = hardPvConsumersFromInput(input);
		assert.equal(bound.length, 2);
		const sum = bound.reduce((s, b) => s + (b.maxPowerW ?? 0), 0);
		assert.equal(sum, 850 + 600);
	});

	it("Unit ohne Gruppe bleibt eigenständig", () => {
		const input = baseInput([unit("air_conditioning.unit_1", 850, null)]);
		const bound = hardPvConsumersFromInput(input);
		assert.equal(bound.length, 1);
		assert.equal(bound[0]!.maxPowerW, 850);
	});

	it("Gruppen-Elektrik aus Allokationszellen = max nicht Summe", () => {
		const slotStart = "2026-08-29T12:00:00.000Z";
		const consumers = [
			{
				consumerId: "air_conditioning.unit_1",
				kind: "climate" as const,
				remainingKwh: 1,
				maxPowerW: 850,
				minPowerW: null,
				deadlineMs: Number.POSITIVE_INFINITY,
				mandatory: true,
				gridEligible: true,
				pvFirst: false,
				batteryEligible: true,
				energyGoalHard: true,
				maxShiftHours: 0,
				earliestSlotIdx: 0,
				thermalBeforeDeadline: false,
				thermalSoftOnly: false,
				sharedPowerGroupId: "outdoor_1",
			},
			{
				consumerId: "air_conditioning.unit_2",
				kind: "climate" as const,
				remainingKwh: 1,
				maxPowerW: 700,
				minPowerW: null,
				deadlineMs: Number.POSITIVE_INFINITY,
				mandatory: true,
				gridEligible: true,
				pvFirst: false,
				batteryEligible: true,
				energyGoalHard: true,
				maxShiftHours: 0,
				earliestSlotIdx: 0,
				thermalBeforeDeadline: false,
				thermalSoftOnly: false,
				sharedPowerGroupId: "outdoor_1",
			},
		];
		const cells: UnifiedAllocationCell[] = [
			{
				slot: { startIso: slotStart, endIso: "2026-08-29T12:15:00.000Z" },
				consumerId: "air_conditioning.unit_1",
				kind: "climate",
				allocatedPowerW: 850,
				allocatedEnergyKwh: energyFromPowerW(850),
				energySource: "pv_surplus",
				constraintIds: [],
				reasonCodes: [],
			},
			{
				slot: { startIso: slotStart, endIso: "2026-08-29T12:15:00.000Z" },
				consumerId: "air_conditioning.unit_2",
				kind: "climate",
				allocatedPowerW: 700,
				allocatedEnergyKwh: energyFromPowerW(700),
				energySource: "pv_surplus",
				constraintIds: [],
				reasonCodes: [],
			},
		];
		const elec = climateSharedGroupElectricalKwh(cells, consumers, slotStart, "outdoor_1");
		assert.equal(elec, energyFromPowerW(850), "max(850,700) nicht Summe");
	});
});
