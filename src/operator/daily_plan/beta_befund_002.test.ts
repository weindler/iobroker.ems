/**
 * Beta-Befund 002: konsistente NOW-Bilanz + House-Load-Dekomposition + Remaining.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { operatorQuality } from "../quality";
import {
	applyLiveNowBalanceToCurrentSlot,
	computeLiveNowBalanceW,
	isLiveNowTelemetryUsable,
	slotBalanceIsConsistent,
} from "./live_now_balance";
import { recomputeDailyPlanSlotRemainings } from "./recompute_remainings";
import type { DailyPlan, DailyPlanSlot } from "./types";
import { buildSlots, energyFromPowerW } from "./unified/score_allocate";
import type { UnifiedDayPlannerInput } from "./unified/types";
import {
	applyFlexDecompositionToSamples,
	decomposeHouseLoadBaselineW,
} from "../../learning/house_load/decompose";
import { buildUnifiedInputFromForecastContext } from "./unified/from_forecast_context";
import { allocateUnifiedDayPlan } from "./unified/allocate";
import { golden001Input } from "./unified/fixtures";

const Q = operatorQuality("valid", "test");
const FRESH = { observedAtIso: "2026-08-08T10:07:00.000Z", ageSec: 5, quality: Q };

function slotStub(
	startIso: string,
	endIso: string,
	pv: number,
	house: number,
): DailyPlanSlot {
	const bal = pv - house;
	const avail = Math.max(0, bal);
	return {
		slot: { startIso, endIso },
		pvForecastPowerW: pv,
		fixedHouseLoadPowerW: house,
		fixedBalancePowerW: bal,
		gridPriceCtPerKwh: 20,
		gridImportAllowed: true,
		configuredGridImportLimitW: 11000,
		remainingGridImportPowerW: 11000,
		availablePvSurplusPowerW: avail,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: 0,
		allocatedGridPowerW: 0,
		allocatedBatteryPowerW: 0,
		remainingPvSurplusPowerW: avail,
		remainingGridImportPowerWAfterAlloc: 11000,
		remainingBatteryDischargePowerW: 0,
		allocations: [],
		quality: Q,
		reasonDe: "forecast",
	};
}

describe("Beta-Befund 002 A — NOW konsistent live", () => {
	it("Observed PV 5005 / House 1154 → surplus 3851, Felder live-live", () => {
		const bal = computeLiveNowBalanceW(5005, 1154);
		assert.equal(bal.pvPowerW, 5005);
		assert.equal(bal.houseLoadPowerW, 1154);
		assert.equal(bal.fixedBalancePowerW, 3851);
		assert.equal(bal.availablePvSurplusPowerW, 3851);

		const slots = [
			slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 4232, 2136),
			slotStub("2026-08-08T10:15:00.000Z", "2026-08-08T10:30:00.000Z", 4232, 2136),
		];
		const nowMs = Date.parse("2026-08-08T10:07:00.000Z");
		const ok = applyLiveNowBalanceToCurrentSlot(slots, nowMs, {
			pvPowerW: 5005,
			houseLoadW: 1154,
			pvAgeSec: 10,
			houseAgeSec: 10,
		});
		assert.equal(ok, true);
		assert.equal(slots[0]!.pvForecastPowerW, 5005);
		assert.equal(slots[0]!.fixedHouseLoadPowerW, 1154);
		assert.equal(slots[0]!.fixedBalancePowerW, 3851);
		assert.equal(slots[0]!.availablePvSurplusPowerW, 3851);
		assert.equal(slotBalanceIsConsistent(slots[0]!), true);
	});
});

describe("Beta-Befund 002 B — Zukunft Forecast-only", () => {
	it("Folgeslot bleibt 4232−2136=2096, kein Live-Floor", () => {
		const slots = [
			slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 4232, 2136),
			slotStub("2026-08-08T10:15:00.000Z", "2026-08-08T10:30:00.000Z", 4232, 2136),
		];
		applyLiveNowBalanceToCurrentSlot(slots, Date.parse("2026-08-08T10:07:00.000Z"), {
			pvPowerW: 5005,
			houseLoadW: 1154,
			pvAgeSec: 5,
			houseAgeSec: 5,
		});
		assert.equal(slots[1]!.pvForecastPowerW, 4232);
		assert.equal(slots[1]!.fixedHouseLoadPowerW, 2136);
		assert.equal(slots[1]!.availablePvSurplusPowerW, 2096);
		assert.equal(slotBalanceIsConsistent(slots[1]!), true);
	});
});

describe("Beta-Befund 002 C — No-mix invariant", () => {
	it("reject forecast components + live balance", () => {
		assert.equal(
			slotBalanceIsConsistent({
				pvForecastPowerW: 4232,
				fixedHouseLoadPowerW: 2136,
				fixedBalancePowerW: 3851,
				availablePvSurplusPowerW: 3851,
			}),
			false,
		);
	});

	it("stale live → Forecast-Fallback (keine Live-Felder)", () => {
		assert.equal(
			isLiveNowTelemetryUsable({
				pvPowerW: 5005,
				houseLoadW: 1154,
				pvAgeSec: 500,
				houseAgeSec: 5,
			}),
			false,
		);
		const slots = [slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 4232, 2136)];
		const ok = applyLiveNowBalanceToCurrentSlot(slots, Date.parse("2026-08-08T10:07:00.000Z"), {
			pvPowerW: 5005,
			houseLoadW: 1154,
			pvAgeSec: 500,
			houseAgeSec: 5,
		});
		assert.equal(ok, false);
		assert.equal(slots[0]!.availablePvSurplusPowerW, 2096);
	});
});

describe("Beta-Befund 002 D/E/G — AC-Dekomposition", () => {
	it("D: Measured 1800, AC 700 → baseline 1100", () => {
		const r = decomposeHouseLoadBaselineW(1800, { climateW: 700 });
		assert.equal(r.baselineW, 1100);
		assert.equal(r.subtractedW, 700);
		assert.equal(r.quality, "full");
	});

	it("E: U1+U2 nur einmal bilanziert", () => {
		const r = decomposeHouseLoadBaselineW(2500, {
			climateUnitsW: [700, 715],
			climateW: 1415, // ignoriert wenn Units gesetzt
		});
		assert.equal(r.subtractedW, 1415);
		assert.equal(r.baselineW, 1085);
		assert.equal(r.subtractedParts.filter((p) => p.id.startsWith("climate")).length, 2);
	});

	it("G: Missing AC power → keine negative Baseline, quality markiert", () => {
		const r = decomposeHouseLoadBaselineW(1800, {
			climateUnitsW: [null, 700],
			immersionHeaterW: null,
		});
		assert.ok((r.baselineW ?? -1) >= 0);
		assert.equal(r.baselineW, 1100);
		assert.equal(r.quality, "partial");
		assert.ok(r.missingParts.includes("climate.unit_1"));
		assert.ok(r.missingParts.includes("immersion_heater"));
	});

	it("applyFlexDecompositionToSamples only where flex known", () => {
		const map = new Map([[1000, { climateW: 700 }]]);
		const { samples, decomposedCount } = applyFlexDecompositionToSamples(
			[
				{ hourStartMs: 1000, powerW: 1800 },
				{ hourStartMs: 2000, powerW: 1800 },
			],
			map,
		);
		assert.equal(samples[0]!.powerW, 1100);
		assert.equal(samples[1]!.powerW, 1800);
		assert.equal(decomposedCount, 1);
	});
});

describe("Beta-Befund 002 Score-Allocator NOW observed", () => {
	it("NOW uses observed surplus 3851, future forecast 2096", () => {
		const nowIso = "2026-08-08T10:07:00.000Z";
		const slots = [
			{ startIso: "2026-08-08T10:00:00.000Z", endIso: "2026-08-08T10:15:00.000Z" },
			{ startIso: "2026-08-08T10:15:00.000Z", endIso: "2026-08-08T10:30:00.000Z" },
		];
		const input: UnifiedDayPlannerInput = {
			schemaVersion: 1,
			planIntent: "unified_day",
			time: {
				nowIso,
				timezone: "Europe/Berlin",
				horizonStartIso: slots[0]!.startIso,
				horizonEndIso: slots[1]!.endIso,
				slotMinutes: 15,
				slots,
				freshness: FRESH,
			},
			globalMode: "balanced",
			pv: {
				expectedDayEnergyKwh: 40,
				uncertainty: Q,
				freshness: FRESH,
				biasCorrected: true,
				biasPct: null,
				previousExpectedDayEnergyKwh: null,
				slots: [
					{
						slot: slots[0]!,
						forecastPowerW: 4232,
						observedPowerW: 5005,
						energyKwh: energyFromPowerW(5005),
					},
					{
						slot: slots[1]!,
						forecastPowerW: 4232,
						observedPowerW: null,
						energyKwh: energyFromPowerW(4232),
					},
				],
			},
			houseLoad: {
				expectedDayEnergyKwh: 22,
				uncertainty: Q,
				freshness: FRESH,
				slots: [
					{
						slot: slots[0]!,
						forecastPowerW: 2136,
						observedPowerW: 1154,
						energyKwh: energyFromPowerW(1154),
					},
					{
						slot: slots[1]!,
						forecastPowerW: 2136,
						observedPowerW: null,
						energyKwh: energyFromPowerW(2136),
					},
				],
			},
			prices: {
				uncertainty: Q,
				freshness: FRESH,
				slots: slots.map((s) => ({
					slot: s,
					importCtPerKwh: 20,
					exportCtPerKwh: null,
					gridImportAllowed: true,
				})),
			},
			battery: {
				socPct: 50,
				usableCapacityKwh: 10,
				maxChargePowerW: 5000,
				maxDischargePowerW: null,
				minSocPct: 10,
				maxSocPct: 100,
				reserveSocPct: 20,
				nightReserveKwh: null,
				chargeEfficiency: 0.95,
				dischargeEfficiency: 0.95,
				allowedModes: ["idle", "charge"],
				requiredChargeEnergyKwh: null,
				endSocTargetPct: null,
				chargeDeadlineIso: null,
				gridChargeAllowed: true,
				profileId: "sonnen_em",
				dischargeLiveSupported: false,
				passiveBatteryEnergyAvailable: true,
				uncertainty: Q,
				freshness: FRESH,
			},
			thermal: null,
			climate: null,
			wallbox: null,
			otherFlex: [],
			contributionRevision: 1,
		};

		const work = buildSlots(input);
		assert.ok(Math.abs(work[0]!.surplusKwh - energyFromPowerW(3851)) < 1e-9);
		assert.ok(Math.abs(work[1]!.surplusKwh - energyFromPowerW(2096)) < 1e-9);
	});
});

describe("Beta-Befund 002 F — AC Runtime-Hold", () => {
	it("Hold: NOW keine Flex-Allocation, Forecast-NOW reserviert Hold-Last", () => {
		const base = golden001Input();
		const nowIso = "2026-08-04T10:07:00.000Z";
		const slot0 = { startIso: "2026-08-04T10:00:00.000Z", endIso: "2026-08-04T10:15:00.000Z" };
		const keep = base.time.slots.filter((s) => s.startIso >= slot0.startIso).slice(0, 4);
		base.time = {
			...base.time,
			nowIso,
			slots: keep,
			horizonStartIso: keep[0]!.startIso,
			horizonEndIso: keep[keep.length - 1]!.endIso,
		};
		base.pv.slots = keep.map((s) => ({
			slot: s,
			forecastPowerW: 4000,
			observedPowerW: null,
			energyKwh: energyFromPowerW(4000),
		}));
		base.houseLoad.slots = keep.map((s) => ({
			slot: s,
			forecastPowerW: 1000,
			observedPowerW: null,
			energyKwh: energyFromPowerW(1000),
		}));
		base.prices.slots = keep.map((s) => ({
			slot: s,
			importCtPerKwh: 15,
			exportCtPerKwh: null,
			gridImportAllowed: true,
		}));
		base.thermal = null;
		base.climate = {
			freshness: FRESH,
			units: [
				{
					unitId: "air_conditioning.unit_2",
					label: "Josef",
					roomTempC: 23,
					comfortMinC: null,
					comfortMaxC: 25,
					targetTempC: 25,
					mandatoryComfort: false,
					expectedEnergyKwh: 2,
					typicalPowerW: 700,
					maxShiftHours: 3,
					uncertainty: Q,
					hardwareRunning: true,
					runtimeHold: true,
					holdPowerW: 700,
				},
			],
		};

		const work = buildSlots(base);
		const nowWork = work.find((w) => w.startIso === slot0.startIso)!;
		// 4000−1000=3000 surplus forecast, minus 700 hold → 2300
		assert.ok(Math.abs(nowWork.surplusKwh - energyFromPowerW(2300)) < 1e-6);

		const plan = allocateUnifiedDayPlan(base, { generation: 1 });
		const nowAc = plan.allocations.filter(
			(a) =>
				a.kind === "climate" &&
				a.consumerId.includes("unit_2") &&
				a.slot.startIso === slot0.startIso,
		);
		assert.equal(nowAc.length, 0, "Runtime-Hold darf keine NOW-Flex-Allocation erzeugen");
	});
});

describe("Beta-Befund 002 H — Remaining nach Unified", () => {
	it("remainingPv = available − allocatedPv", () => {
		const slot = slotStub("2026-08-08T10:00:00.000Z", "2026-08-08T10:15:00.000Z", 5005, 1154);
		slot.availablePvSurplusPowerW = 3851;
		slot.allocations = [
			{
				contributionId: "immersion_heater.flexible",
				contributor: { type: "addon", id: "immersion_heater", addonId: "immersion_heater" },
				slot: slot.slot,
				status: "allocated",
				energySource: "pv_surplus",
				requestedPowerW: 1700,
				allocatedPowerW: 1700,
				requestedEnergyKwh: 0.425,
				allocatedEnergyKwh: 0.425,
				gridPowerW: 0,
				pvPowerW: 1700,
				batteryPowerW: 0,
				mandatory: false,
				priorityRank: null,
				deadlineIso: null,
				estimatedCostCt: null,
				reasonDe: "test",
			},
		];
		const plan: DailyPlan = {
			generatedAt: new Date().toISOString(),
			validUntil: null,
			revision: 1,
			date: "2026-08-08",
			timezone: "Europe/Berlin",
			slotMinutes: 15,
			globalMode: "balanced",
			status: "ready",
			activeContributionIds: [],
			excludedContributions: [],
			slots: [slot],
			allocations: slot.allocations,
			unallocated: [],
			totals: {
				pvForecastEnergyKwh: null,
				fixedHouseLoadEnergyKwh: null,
				fixedRenewableBalanceKwh: null,
				flexibleRequestedEnergyKwh: null,
				flexibleAllocatedEnergyKwh: 0.425,
				flexibleUnallocatedEnergyKwh: null,
				pvAllocatedEnergyKwh: 0.425,
				gridAllocatedEnergyKwh: 0,
				batteryChargeEnergyKwh: 0,
				wallboxEnergyKwh: 0,
				immersionHeaterEnergyKwh: 0.425,
				airConditioningEnergyKwh: 0,
				estimatedGridCostCt: null,
				mandatoryRequestedEnergyKwh: null,
				mandatoryAllocatedEnergyKwh: 0,
				mandatoryUnallocatedEnergyKwh: null,
			},
			quality: Q,
			reasonDe: "test",
			policySnapshot: {},
			constraintSnapshot: {},
		};
		const out = recomputeDailyPlanSlotRemainings(plan);
		assert.equal(out.slots[0]!.allocatedPvPowerW, 1700);
		assert.equal(out.slots[0]!.remainingPvSurplusPowerW, 2151);
		assert.equal(out.slots[0]!.allocatedFlexiblePowerW, 1700);
	});
});

describe("Beta-Befund 002 bridge live usable gate", () => {
	it("stale observed not copied into Unified slots", () => {
		const fp = {
			slots: [
				{
					slot: { startIso: "2026-08-08T10:00:00.000Z", endIso: "2026-08-08T10:15:00.000Z" },
					pvPowerW: 4232,
					houseLoadPowerW: 2136,
					fixedBalancePowerW: 2096,
					gridPriceCtPerKwh: 20,
					gridImportAllowed: true,
					gridMaxImportPowerW: null,
					outdoorTempC: null,
					quality: Q,
					reasonDe: "fixture",
				},
			],
			days: [],
			contributions: [],
		};
		const input = buildUnifiedInputFromForecastContext({
			now: new Date("2026-08-08T10:07:00.000Z"),
			timezone: "Europe/Berlin",
			globalMode: "balanced",
			forecastPlan: fp,
			observedPvPowerW: 5005,
			observedHouseLoadPowerW: 1154,
			observedPvAgeSec: 400,
			observedHouseAgeSec: 5,
		});
		assert.equal(input.pv.slots[0]!.observedPowerW, null);
		assert.equal(input.houseLoad.slots[0]!.observedPowerW, null);
	});
});
