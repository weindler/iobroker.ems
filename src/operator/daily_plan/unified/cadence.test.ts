import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../../quality";
import type { DailyPlan } from "../types";
import { unifiedPlanCadenceDigest } from "./cadence";
import {
	resetDailyPlanRevisionForTest,
	runDailyPlanTick,
	unifiedPlanGenerationForTest,
} from "../tick";
import type { ForecastPlan } from "../../forecast/types";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { baseContribution, pvContributorRef } from "../../contributions/types";
import { addonContributorRef, systemContributorRef } from "../../contributor";

function planStub(overrides: Partial<DailyPlan> = {}): DailyPlan {
	const baseTotals = {
		pvForecastEnergyKwh: 18,
		fixedHouseLoadEnergyKwh: 12,
		fixedRenewableBalanceKwh: 6,
		flexibleRequestedEnergyKwh: 4,
		flexibleAllocatedEnergyKwh: 3,
		flexibleUnallocatedEnergyKwh: 1,
		pvAllocatedEnergyKwh: 3,
		gridAllocatedEnergyKwh: 0,
		batteryChargeEnergyKwh: 1,
		wallboxEnergyKwh: 0,
		immersionHeaterEnergyKwh: 2,
		airConditioningEnergyKwh: 0,
		estimatedGridCostCt: null as number | null,
		mandatoryRequestedEnergyKwh: null as number | null,
		mandatoryAllocatedEnergyKwh: 0,
		mandatoryUnallocatedEnergyKwh: null as number | null,
	};
	return {
		generatedAt: "2026-08-07T10:00:00.000Z",
		validUntil: null,
		revision: 1,
		date: "2026-08-07",
		timezone: "Europe/Berlin",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: ["immersion_heater.flexible", "battery.charge"],
		excludedContributions: [],
		slots: [
			{
				slot: { startIso: "2026-08-07T10:00:00.000Z", endIso: "2026-08-07T10:15:00.000Z" },
				pvForecastPowerW: 2000,
				fixedHouseLoadPowerW: 500,
				fixedBalancePowerW: 1500,
				gridPriceCtPerKwh: 20,
				gridImportAllowed: true,
				configuredGridImportLimitW: null,
				remainingGridImportPowerW: null,
				availablePvSurplusPowerW: 1500,
				allocatedFlexiblePowerW: 0,
				allocatedPvPowerW: 0,
				allocatedGridPowerW: 0,
				allocatedBatteryPowerW: 0,
				remainingPvSurplusPowerW: 1500,
				remainingGridImportPowerWAfterAlloc: null,
				remainingBatteryDischargePowerW: null,
				allocations: [],
				quality: operatorQuality("valid", "t", 80),
				reasonDe: "t",
			},
		],
		allocations: [],
		unallocated: [],
		totals: { ...baseTotals, ...overrides.totals },
		quality: operatorQuality("valid", "t", 80),
		reasonDe: "t",
		...overrides,
	};
}

describe("CADENCE-001 unchanged material → same digest", () => {
	it("two plans with only slot-roll / tiny allocation noise share digest", () => {
		const a = planStub();
		const b = planStub({
			generatedAt: "2026-08-07T10:01:00.000Z",
			revision: 2,
			slots: [
				{
					...planStub().slots[0],
					slot: { startIso: "2026-08-07T10:15:00.000Z", endIso: "2026-08-07T10:30:00.000Z" },
					allocatedFlexiblePowerW: 100,
				},
			],
		});
		assert.equal(unifiedPlanCadenceDigest(a), unifiedPlanCadenceDigest(b));
	});
});

describe("CADENCE-002 local day change", () => {
	it("date change yields new digest", () => {
		const a = planStub({ date: "2026-08-07" });
		const b = planStub({ date: "2026-08-08" });
		assert.notEqual(unifiedPlanCadenceDigest(a), unifiedPlanCadenceDigest(b));
	});
});

describe("CADENCE-003 relevant forecast revision", () => {
	it("large PV day-energy change yields new digest", () => {
		const a = planStub({ totals: { ...planStub().totals, pvForecastEnergyKwh: 18 } });
		const b = planStub({ totals: { ...planStub().totals, pvForecastEnergyKwh: 28 } });
		assert.notEqual(unifiedPlanCadenceDigest(a), unifiedPlanCadenceDigest(b));
	});

	it("wallbox family appearing (connected) yields new digest", () => {
		const a = planStub({ activeContributionIds: ["immersion_heater.flexible"] });
		const b = planStub({
			activeContributionIds: ["immersion_heater.flexible", "wallbox.ev_session"],
		});
		assert.notEqual(unifiedPlanCadenceDigest(a), unifiedPlanCadenceDigest(b));
	});
});

describe("CADENCE-004 irrelevant telemetry / micro change", () => {
	it("sub-bucket flexible energy noise keeps digest", () => {
		const c = planStub({ totals: { ...planStub().totals, flexibleRequestedEnergyKwh: 4.05 } });
		const d = planStub({ totals: { ...planStub().totals, flexibleRequestedEnergyKwh: 4.14 } });
		assert.equal(unifiedPlanCadenceDigest(c), unifiedPlanCadenceDigest(d));
	});

	it("price micro-change below median bucket keeps digest", () => {
		const base = planStub();
		const a = planStub({
			slots: [{ ...base.slots[0], gridPriceCtPerKwh: 20 }],
		});
		const b = planStub({
			slots: [{ ...base.slots[0], gridPriceCtPerKwh: 22 }],
		});
		assert.equal(unifiedPlanCadenceDigest(a), unifiedPlanCadenceDigest(b));
	});
});

function mockHost() {
	const states = new Map<string, unknown>();
	return {
		config: {
			intent_timezone: "UTC",
			bat_hw_max_charge_w: 5000,
			bat_hw_min_soc_pct: 10,
			bat_hw_max_soc_pct: 100,
		},
		log: { warn: () => {}, debug: () => {} },
		async getStateAsync(id: string) {
			if (!states.has(id)) return null;
			return { val: states.get(id), ts: Date.now() };
		},
		async setStateAsync(id: string, state: { val?: unknown } | unknown) {
			const val = state && typeof state === "object" && "val" in (state as object)
				? (state as { val: unknown }).val
				: state;
			states.set(id, val);
		},
		async getForeignStateAsync() {
			return null;
		},
	};
}

function forecastForTick(now: Date, pvDayKwh: number): ForecastPlan {
	const start = "2026-08-07T10:00:00.000Z";
	const end = "2026-08-07T10:15:00.000Z";
	return {
		generatedAt: now.toISOString(),
		validUntil: null,
		revision: 1,
		timezone: "UTC",
		horizonStart: start,
		horizonEnd: "2026-08-09T10:00:00.000Z",
		slotMinutes: 15,
		status: "ready",
		activeContributors: [],
		excludedContributors: [],
		days: [
			{
				date: "2026-08-07",
				pvEnergyKwh: pvDayKwh,
				houseLoadEnergyKwh: 10,
				renewableBalanceKwh: pvDayKwh - 10,
				weatherMinTempC: null,
				weatherMaxTempC: null,
				quality: operatorQuality("valid", "OK"),
				reasonDe: "OK",
			},
		],
		slots: [
			{
				slot: { startIso: start, endIso: end },
				pvPowerW: 3000,
				houseLoadPowerW: 500,
				fixedBalancePowerW: 2500,
				gridPriceCtPerKwh: 20,
				gridImportAllowed: true,
				gridMaxImportPowerW: 11000,
				outdoorTempC: null,
				quality: operatorQuality("valid", "OK"),
				reasonDe: "OK",
			},
		],
		contributions: [
			baseContribution(CONTRIBUTION_IDS.PV_SUPPLY, pvContributorRef(), "provide", ["supply"], {
				generatedAt: now.toISOString(),
				validUntil: null,
				revision: 1,
				enabled: true,
				flexible: false,
				gridEligible: false,
				quality: operatorQuality("valid", "PV", 80),
				reasonDe: "PV",
				details: {
					correctedTodayKwh: pvDayKwh,
					rawTodayKwh: pvDayKwh,
					lastUpdateTs: now.toISOString(),
					status: "ready",
				},
				slots: [],
			}),
			baseContribution(
				CONTRIBUTION_IDS.HOUSE_LOAD_FIXED,
				systemContributorRef("house_load"),
				"consume",
				["demand_fixed"],
				{
					generatedAt: now.toISOString(),
					validUntil: null,
					revision: 1,
					enabled: true,
					flexible: false,
					gridEligible: false,
					quality: operatorQuality("valid", "load", 70),
					reasonDe: "load",
					details: {},
					slots: [],
				},
			),
			baseContribution(
				CONTRIBUTION_IDS.GRID_SUPPLY,
				systemContributorRef("grid_supply"),
				"provide",
				["supply"],
				{
					generatedAt: now.toISOString(),
					validUntil: null,
					revision: 1,
					enabled: true,
					flexible: false,
					gridEligible: true,
					quality: operatorQuality("valid", "grid", 90),
					reasonDe: "grid",
					details: {},
					slots: [],
				},
			),
			baseContribution(
				CONTRIBUTION_IDS.BATTERY_CHARGE,
				addonContributorRef("battery"),
				"consume",
				["storage"],
				{
					generatedAt: now.toISOString(),
					validUntil: null,
					revision: 1,
					enabled: true,
					flexible: true,
					gridEligible: false,
					quality: operatorQuality("valid", "bat", 80),
					reasonDe: "bat",
					details: { socPct: 40, maxChargePowerW: 5000, requiredEnergyKwh: 2 },
					slots: [],
				},
			),
		],
		quality: operatorQuality("valid", "OK"),
		reasonDe: "OK",
	};
}

describe("CADENCE tick gate — no Unified regen without material change", () => {
	it("CADENCE-001: second tick without material change does not bump unified generation", async () => {
		resetDailyPlanRevisionForTest();
		const host = mockHost();
		const now = new Date("2026-08-07T10:07:00.000Z");
		const fp = forecastForTick(now, 18);
		await runDailyPlanTick(host as never, fp);
		const gen1 = unifiedPlanGenerationForTest();
		assert.ok(gen1 >= 1);
		await runDailyPlanTick(host as never, fp);
		assert.equal(unifiedPlanGenerationForTest(), gen1);
	});

	it("CADENCE-003 via tick: large PV change bumps unified generation", async () => {
		resetDailyPlanRevisionForTest();
		const host = mockHost();
		const now = new Date("2026-08-07T10:07:00.000Z");
		await runDailyPlanTick(host as never, forecastForTick(now, 18));
		const gen1 = unifiedPlanGenerationForTest();
		await runDailyPlanTick(host as never, forecastForTick(now, 30));
		assert.ok(unifiedPlanGenerationForTest() > gen1);
	});
});
