/**
 * REPLAN-001…010 — Material Replanning + Plan-vs-Actual.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { allocateUnifiedDayPlan } from "./allocate";
import { alloc001Input, alloc002Input, alloc004Input } from "./alloc_fixtures";
import {
	evaluateMaterialReplan,
	pvRevisionContext,
	REPLAN_COOLDOWN_MS,
	type PlanActualSample,
	type PlanBaseline,
} from "./materiality";
import { REASON } from "./reason_codes";
import { buildDayEvaluationDraft } from "./day_evaluation";
import {
	assessUnifiedReplanFailure,
	applyReplanFailureAuthority,
} from "./replan_failure";
import { buildUnifiedIhAcDispatchPublish } from "./dispatch_bridge";
import { applyUnifiedIhAcAuthority } from "./authority";
import { priceStructureDigestFromPlan } from "../../../ai/trigger_digest";
import { unifiedPlanCadenceDigest } from "./cadence";
import type { DailyPlan, DailyPlanSlot } from "../types";
import { operatorQuality } from "../../quality";
import type { UnifiedDayPlan } from "./types";

function baseline(overrides: Partial<PlanBaseline> = {}): PlanBaseline {
	return {
		date: "2026-08-07",
		planId: "p1",
		generation: 1,
		createdAtMs: Date.parse("2026-08-07T08:00:00.000Z"),
		expectedPvDayKwh: 30,
		realizedPvKwhAtPlan: 2,
		expectedHouseLoadDayKwh: 12,
		batterySocPct: 40,
		thermalHeadroomKwh: 4,
		bufferTempC: 48,
		acMandatoryAny: false,
		vehicleConnected: false,
		vehicleRequiredEnergyKwh: null,
		vehicleDeadlineIso: null,
		vehicleTargetSocPct: null,
		priceMedianCt: 22,
		priceStructureDigest: "price-struct-v1",
		presenceDigest: "presence-v1",
		cadenceDigest: "digest-v1",
		...overrides,
	};
}

function actual(overrides: Partial<PlanActualSample> = {}): PlanActualSample {
	return {
		date: "2026-08-07",
		nowMs: Date.parse("2026-08-07T10:00:00.000Z"),
		forecastPvDayKwh: 30,
		realizedPvKwh: 2.1,
		forecastHouseLoadDayKwh: 12,
		batterySocPct: 40.5,
		thermalHeadroomKwh: 3.9,
		bufferTempC: 48.2,
		acMandatoryAny: false,
		vehicleConnected: false,
		vehicleRequiredEnergyKwh: null,
		vehicleDeadlineIso: null,
		vehicleTargetSocPct: null,
		priceMedianCt: 22,
		priceStructureDigest: "price-struct-v1",
		presenceDigest: "presence-v1",
		thermalBlocked: false,
		cadenceDigest: "digest-v1",
		...overrides,
	};
}

describe("REPLAN-001 no material change", () => {
	it("many small ticks → no replan", () => {
		const b = baseline();
		for (let i = 0; i < 12; i++) {
			const d = evaluateMaterialReplan(
				b,
				actual({
					nowMs: Date.parse("2026-08-07T10:00:00.000Z") + i * 60_000,
					realizedPvKwh: 2 + i * 0.02,
					batterySocPct: 40 + (i % 3) * 0.3,
					bufferTempC: 48 + (i % 2) * 0.2,
					thermalHeadroomKwh: 4 - i * 0.01,
				}),
				{ lastReplanAtMs: b.createdAtMs },
			);
			assert.equal(d.shouldReplan, false, `tick ${i}: ${d.reasons.join(",")}`);
		}
	});
});

describe("REPLAN-002 PV forecast collapse", () => {
	it("material PV forecast drop → replan + remaining goals reallocated", () => {
		const b = baseline({ expectedPvDayKwh: 30 });
		const d = evaluateMaterialReplan(
			b,
			actual({
				forecastPvDayKwh: 12,
				cadenceDigest: "digest-pv-down",
			}),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_PV_FORECAST_CHANGED));

		const input = alloc004Input();
		input.pv.expectedDayEnergyKwh = 12;
		input.pv.previousExpectedDayEnergyKwh = 30;
		input.pv.slots = input.pv.slots.map((s) => ({
			...s,
			forecastPowerW: (s.forecastPowerW ?? 0) * 0.4,
			energyKwh: (s.energyKwh ?? 0) * 0.4,
		}));
		const plan = allocateUnifiedDayPlan(input, {
			generation: 2,
			extraReasonCodes: d.reasons,
		});
		assert.equal(plan.generation, 2);
		assert.ok(plan.reasonCodes.includes(REASON.REPLAN_PV_FORECAST_CHANGED));
		const gridWb = plan.allocations
			.filter((a) => a.kind === "wallbox" && a.energySource === "grid")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(gridWb > 1, `expected grid import for hard deadline after PV collapse, got ${gridWb}`);
	});
});

describe("REPLAN-003 PV clearly better", () => {
	it("material PV up → replan can use extra flex", () => {
		const b = baseline({ expectedPvDayKwh: 18, thermalHeadroomKwh: 5 });
		const d = evaluateMaterialReplan(
			b,
			actual({
				forecastPvDayKwh: 28,
				cadenceDigest: "digest-pv-up",
				thermalHeadroomKwh: 5,
			}),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_PV_FORECAST_CHANGED));

		const low = alloc001Input();
		low.pv.expectedDayEnergyKwh = 18;
		const lowPlan = allocateUnifiedDayPlan(low);
		const high = alloc001Input();
		high.pv.slots = high.pv.slots.map((s) => ({
			...s,
			forecastPowerW: (s.forecastPowerW ?? 0) * 1.6,
			energyKwh: (s.energyKwh ?? 0) * 1.6,
		}));
		high.pv.expectedDayEnergyKwh = high.pv.slots.reduce((a, s) => a + (s.energyKwh ?? 0), 0);
		high.pv.previousExpectedDayEnergyKwh = 18;
		const highPlan = allocateUnifiedDayPlan(high, {
			generation: 2,
			extraReasonCodes: [REASON.REPLAN_PV_FORECAST_CHANGED],
		});
		const ihLow = lowPlan.allocations
			.filter((a) => a.kind === "immersion_heater")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		const ihHigh = highPlan.allocations
			.filter((a) => a.kind === "immersion_heater")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		const batHigh = highPlan.allocations
			.filter((a) => a.kind === "battery_charge")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(
			ihHigh + batHigh >= ihLow,
			`extra PV should enable flex: ih ${ihLow}→${ihHigh}, bat=${batHigh}`,
		);
	});
});

describe("REPLAN-004 battery SOC deviation", () => {
	it("relevant SOC delta → replan", () => {
		const d = evaluateMaterialReplan(
			baseline({ batterySocPct: 40 }),
			actual({ batterySocPct: 28 }),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_BATTERY_SOC_DEVIATION));
	});
});

describe("REPLAN-005 thermal target reached early", () => {
	it("headroom collapses → replan; IH allocations shrink", () => {
		const d = evaluateMaterialReplan(
			baseline({ thermalHeadroomKwh: 4 }),
			actual({ thermalHeadroomKwh: 0, bufferTempC: 56 }),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_THERMAL_DEVIATION));

		const need = alloc001Input();
		need.thermal = { ...need.thermal!, headroomEnergyKwh: 5 };
		const withNeed = allocateUnifiedDayPlan(need);
		const done = alloc001Input();
		done.thermal = { ...done.thermal!, headroomEnergyKwh: 0, dayTargetTempC: 56 };
		done.time = { ...done.time, nowIso: "2026-08-04T14:00:00.000Z" };
		const after = allocateUnifiedDayPlan(done, {
			generation: 2,
			extraReasonCodes: [REASON.REPLAN_THERMAL_DEVIATION],
			previousPlan: withNeed,
		});
		const futureIh = after.allocations
			.filter(
				(a) =>
					a.kind === "immersion_heater" &&
					Date.parse(a.slot.startIso) >= Date.parse("2026-08-04T14:00:00.000Z"),
			)
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(futureIh < 0.2, `future IH should be cleared, got ${futureIh}`);
	});
});

describe("REPLAN-006 vehicle disconnect", () => {
	it("disconnect → replan; future wallbox allocation gone", () => {
		const d = evaluateMaterialReplan(
			baseline({ vehicleConnected: true, vehicleRequiredEnergyKwh: 18 }),
			actual({ vehicleConnected: false, vehicleRequiredEnergyKwh: 18 }),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_VEHICLE_DISCONNECTED));
		assert.equal(d.hard, true);

		const input = alloc002Input();
		input.wallbox = {
			...input.wallbox!,
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					startIso: "2026-08-04T00:00:00.000Z",
					endIso: "2026-08-05T00:00:00.000Z",
				},
			],
		};
		const first = allocateUnifiedDayPlan(input);
		assert.ok(first.allocations.some((a) => a.kind === "wallbox"));

		const disc = {
			...input,
			wallbox: {
				...input.wallbox!,
				connectedNow: false,
				// Live-Disconnect: keine zukünftige Presence (kein Future-Presence-Engine-Hardcode).
				presenceWindows: [],
			},
			time: { ...input.time, nowIso: "2026-08-04T14:00:00.000Z" },
		};
		const second = allocateUnifiedDayPlan(disc, {
			generation: 2,
			extraReasonCodes: [REASON.REPLAN_VEHICLE_DISCONNECTED],
			previousPlan: first,
		});
		const futureWb = second.allocations.filter(
			(a) =>
				a.kind === "wallbox" &&
				Date.parse(a.slot.endIso) > Date.parse("2026-08-04T14:00:00.000Z"),
		);
		assert.equal(futureWb.length, 0);
	});
});

describe("REPLAN-007 vehicle reconnect", () => {
	it("reconnect → replan; rest need reconsidered", () => {
		const d = evaluateMaterialReplan(
			baseline({ vehicleConnected: false, vehicleRequiredEnergyKwh: 10 }),
			actual({
				vehicleConnected: true,
				vehicleRequiredEnergyKwh: 10,
				vehicleDeadlineIso: "2026-08-07T20:00:00.000Z",
			}),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_VEHICLE_CONNECTED));

		const input = alloc002Input();
		input.wallbox = {
			...input.wallbox!,
			connectedNow: true,
			presenceWindows: [
				{
					available: true,
					startIso: "2026-08-04T14:00:00.000Z",
					endIso: "2026-08-05T00:00:00.000Z",
				},
			],
			requiredEnergyKwh: 8,
			deadlineIso: "2026-08-04T22:00:00.000Z",
		};
		input.time = { ...input.time, nowIso: "2026-08-04T14:05:00.000Z" };
		const plan = allocateUnifiedDayPlan(input, {
			generation: 3,
			extraReasonCodes: [REASON.REPLAN_VEHICLE_CONNECTED],
		});
		const wb = plan.allocations
			.filter((a) => a.kind === "wallbox")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(wb > 0.5, `expected wallbox rest allocation, got ${wb}`);
	});
});

describe("REPLAN-008 price revision", () => {
	it("material price median change → replan", () => {
		const d = evaluateMaterialReplan(
			baseline({ priceMedianCt: 20 }),
			actual({ priceMedianCt: 28, cadenceDigest: "digest-price" }),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_PRICE_REVISION));
	});
});

describe("REPLAN-009 anti-chatter", () => {
	it("after replan, soft wobble within cooldown does not replan", () => {
		const last = Date.parse("2026-08-07T10:00:00.000Z");
		const d = evaluateMaterialReplan(
			baseline({ batterySocPct: 40, createdAtMs: last }),
			actual({
				nowMs: last + 60_000,
				batterySocPct: 46, // material, but soft + cooldown
			}),
			{ lastReplanAtMs: last },
		);
		assert.equal(d.shouldReplan, false);
		assert.ok(d.reasons.includes(REASON.REPLAN_BATTERY_SOC_DEVIATION));
		assert.ok(REPLAN_COOLDOWN_MS >= 60_000);

		const afterCooldown = evaluateMaterialReplan(
			baseline({ batterySocPct: 40 }),
			actual({
				nowMs: last + REPLAN_COOLDOWN_MS + 1,
				batterySocPct: 46,
			}),
			{ lastReplanAtMs: last },
		);
		assert.equal(afterCooldown.shouldReplan, true);
	});

	it("hard vehicle event bypasses cooldown", () => {
		const last = Date.parse("2026-08-07T10:00:00.000Z");
		const d = evaluateMaterialReplan(
			baseline({ vehicleConnected: true }),
			actual({ nowMs: last + 30_000, vehicleConnected: false }),
			{ lastReplanAtMs: last },
		);
		assert.equal(d.shouldReplan, true);
		assert.equal(d.hard, true);
	});
});

describe("REPLAN-010 past stays past", () => {
	it("replan at 14:00 only reallocates remaining horizon", () => {
		const input = alloc001Input();
		const morning = allocateUnifiedDayPlan(input);
		const pastSlot = morning.allocations.find(
			(a) => Date.parse(a.slot.endIso) <= Date.parse("2026-08-04T14:00:00.000Z"),
		);
		assert.ok(pastSlot, "fixture should have morning allocations");

		const noon = {
			...input,
			time: { ...input.time, nowIso: "2026-08-04T14:00:00.000Z" },
			thermal: { ...input.thermal!, headroomEnergyKwh: 1 },
			pv: {
				...input.pv,
				previousExpectedDayEnergyKwh: input.pv.expectedDayEnergyKwh,
			},
		};
		const replanned = allocateUnifiedDayPlan(noon, {
			generation: 2,
			previousPlan: morning,
			extraReasonCodes: [REASON.REPLAN_THERMAL_DEVIATION],
		});
		assert.ok(Date.parse(replanned.horizonStartIso) >= Date.parse("2026-08-04T13:45:00.000Z"));
		const preserved = replanned.allocations.filter(
			(a) => Date.parse(a.slot.endIso) <= Date.parse("2026-08-04T14:00:00.000Z"),
		);
		assert.ok(preserved.length > 0);
		assert.ok(
			preserved.some(
				(a) =>
					a.slot.startIso === pastSlot!.slot.startIso &&
					a.consumerId === pastSlot!.consumerId &&
					a.allocatedEnergyKwh === pastSlot!.allocatedEnergyKwh,
			),
			"past allocation cell must be preserved verbatim",
		);
	});
});

function thermalOk(headroom = 4) {
	return {
		bufferTempC: 48,
		minTempC: 40,
		maxTempC: 65,
		dayTargetTempC: 56,
		availablePowerW: 1700,
		minPowerW: 400,
		headroomEnergyKwh: headroom,
		estimatedEmptyAtIso: null,
		coolingRateCPerH: null,
		minimumRuntimeSec: null,
		hysteresisK: null,
		uncertainty: operatorQuality("valid", "ok", 80),
		freshness: {
			observedAtIso: "2026-08-07T10:00:00.000Z",
			ageSec: 30,
			quality: operatorQuality("valid", "ok", 80),
		},
	};
}

function stubDailyPlan(): DailyPlan {
	return {
		generatedAt: "2026-08-07T10:00:00.000Z",
		validUntil: null,
		revision: 3,
		date: "2026-08-07",
		timezone: "Europe/Berlin",
		slotMinutes: 15,
		globalMode: "balanced",
		status: "ready",
		policySnapshot: {},
		constraintSnapshot: {},
		activeContributionIds: ["immersion_heater.flexible", "air_conditioning.unit_1"],
		excludedContributions: [],
		slots: [],
		allocations: [],
		unallocated: [],
		totals: {
			pvForecastEnergyKwh: 20,
			fixedHouseLoadEnergyKwh: 10,
			fixedRenewableBalanceKwh: 10,
			flexibleRequestedEnergyKwh: 5,
			flexibleAllocatedEnergyKwh: 3,
			flexibleUnallocatedEnergyKwh: 2,
			pvAllocatedEnergyKwh: 3,
			gridAllocatedEnergyKwh: 0,
			batteryChargeEnergyKwh: 0,
			wallboxEnergyKwh: 0,
			immersionHeaterEnergyKwh: 2,
			airConditioningEnergyKwh: 1,
			estimatedGridCostCt: null,
			mandatoryRequestedEnergyKwh: null,
			mandatoryAllocatedEnergyKwh: 0,
			mandatoryUnallocatedEnergyKwh: null,
		},
		quality: operatorQuality("valid", "t", 80),
		reasonDe: "t",
	};
}

describe("REPLAN-FAIL-001 stale IH after failed replan", () => {
	it("clears IH authority when PV/thermal material change invalidates rest slice", () => {
		const input = alloc001Input();
		const unified = allocateUnifiedDayPlan(input);
		assert.ok(unified.allocations.some((a) => a.kind === "immersion_heater"));

		assert.ok(
			unified.allocations.some(
				(a) =>
					a.kind === "immersion_heater" &&
					Date.parse(a.slot.endIso) > Date.parse("2026-08-04T10:00:00.000Z"),
			),
			"fixture needs future IH slice at assessment time",
		);
		const disp = assessUnifiedReplanFailure({
			nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
			lastUnifiedPlan: unified,
			actual: actual({
				nowMs: Date.parse("2026-08-04T10:00:00.000Z"),
				thermalHeadroomKwh: 0,
				bufferTempC: 56,
				forecastPvDayKwh: 8,
			}),
			thermal: {
				...thermalOk(0),
				bufferTempC: 56,
				headroomEnergyKwh: 0,
			},
			climate: null,
			replanReasons: [REASON.REPLAN_PV_FORECAST_CHANGED, REASON.REPLAN_THERMAL_DEVIATION],
		});
		assert.equal(disp.clearImmersion, true);

		const classic = stubDailyPlan();
		const pub = buildUnifiedIhAcDispatchPublish(unified);
		const withIh = applyUnifiedIhAcAuthority(classic, pub.immersionEntries, pub.climateEntries, {
			dailyPlanRevision: 3,
			unifiedPlanId: unified.planId,
		});
		assert.ok(withIh.allocations.some((a) => a.contributionId.startsWith("immersion_heater")));
		const after = applyReplanFailureAuthority(classic, unified, disp);
		assert.equal(
			after.allocations.some((a) => a.contributionId.startsWith("immersion_heater")),
			false,
			"no stale IH live dispatch after failed replan",
		);
	});
});

describe("REPLAN-FAIL-002 AC comfort on failed replan", () => {
	it("clears plan climate dispatch so local comfort path can run; no blind plan cling", () => {
		const unified: UnifiedDayPlan = {
			...allocateUnifiedDayPlan(alloc001Input()),
			allocations: [
				{
					slot: {
						startIso: "2026-08-07T12:00:00.000Z",
						endIso: "2026-08-07T12:15:00.000Z",
					},
					consumerId: "air_conditioning.unit_1",
					kind: "climate",
					allocatedPowerW: 900,
					allocatedEnergyKwh: 0.225,
					energySource: "pv_surplus",
					constraintIds: ["climate.comfort"],
					reasonCodes: ["climate_flex"],
				},
			],
		};
		const disp = assessUnifiedReplanFailure({
			nowMs: Date.parse("2026-08-07T12:05:00.000Z"),
			lastUnifiedPlan: unified,
			actual: actual({ acMandatoryAny: true }),
			thermal: thermalOk(2),
			climate: {
				units: [
					{
						unitId: "air_conditioning.unit_1",
						label: "u1",
						roomTempC: 28,
						comfortMinC: null,
						comfortMaxC: 26,
						targetTempC: 25,
						mandatoryComfort: true,
						expectedEnergyKwh: 1,
						typicalPowerW: 900,
						maxShiftHours: 0,
						uncertainty: operatorQuality("valid", "ok", 80),
					},
				],
				freshness: {
					observedAtIso: "2026-08-07T12:00:00.000Z",
					ageSec: 20,
					quality: operatorQuality("valid", "ok", 80),
				},
			},
			replanReasons: [REASON.REPLAN_AC_COMFORT_CHANGE],
		});
		assert.equal(disp.clearClimate, true);
		assert.equal(disp.clearImmersion, false);
		const after = applyReplanFailureAuthority(stubDailyPlan(), unified, disp);
		assert.equal(
			after.allocations.some((a) => a.contributionId.startsWith("air_conditioning")),
			false,
			"plan climate cleared → runtime Climate-Fallback / local comfort",
		);
	});
});

describe("REPLAN-FAIL-003 rest plan still safe", () => {
	it("keeps all live slices; no new generation publish signal (mustPublish=false path)", () => {
		const unified = allocateUnifiedDayPlan(alloc001Input());
		const disp = assessUnifiedReplanFailure({
			nowMs: Date.parse("2026-08-04T08:00:00.000Z"),
			lastUnifiedPlan: unified,
			actual: actual({
				thermalHeadroomKwh: 4,
				forecastPvDayKwh: 30,
			}),
			thermal: thermalOk(4),
			climate: null,
			battery: alloc001Input().battery,
			wallbox: null,
			// Soft reason that does not invalidate battery/IH rest slices
			replanReasons: [REASON.REPLAN_HOUSE_LOAD_DEVIATION],
		});
		assert.equal(disp.clearImmersion, false);
		assert.equal(disp.clearClimate, false);
		assert.equal(disp.clearBattery, false);
		assert.equal(disp.clearWallbox, false);
		const classic = stubDailyPlan();
		const after = applyReplanFailureAuthority(classic, unified, disp);
		const pub = buildUnifiedIhAcDispatchPublish(unified);
		const kept = applyUnifiedIhAcAuthority(classic, pub.immersionEntries, pub.climateEntries, {
			dailyPlanRevision: classic.revision,
			unifiedPlanId: `${unified.planId}:replan-fail-safe`,
		});
		// Disposition says keep — tick returns without publish; authority helper still can rebuild same slices
		assert.ok(kept.allocations.some((a) => a.contributionId.startsWith("immersion_heater")));
		assert.equal(
			disp.clearImmersion || disp.clearClimate || disp.clearBattery || disp.clearWallbox,
			false,
		);
		void after;
	});
});

function priceSlot(startIso: string, endIso: string, price: number): DailyPlanSlot {
	return {
		slot: { startIso, endIso },
		pvForecastPowerW: null,
		fixedHouseLoadPowerW: null,
		fixedBalancePowerW: null,
		gridPriceCtPerKwh: price,
		gridImportAllowed: true,
		configuredGridImportLimitW: null,
		remainingGridImportPowerW: null,
		availablePvSurplusPowerW: null,
		allocatedFlexiblePowerW: 0,
		allocatedPvPowerW: 0,
		allocatedGridPowerW: 0,
		allocatedBatteryPowerW: 0,
		remainingPvSurplusPowerW: null,
		remainingGridImportPowerWAfterAlloc: null,
		remainingBatteryDischargePowerW: null,
		allocations: [],
		quality: operatorQuality("valid", "p", 90),
		reasonDe: "p",
	};
}

function dayPricePlan(pricesByHourUtc: Array<{ hour: number; price: number }>): DailyPlan {
	const slots = pricesByHourUtc.flatMap(({ hour, price }) => {
		const start = `2026-08-07T${String(hour).padStart(2, "0")}:00:00.000Z`;
		const end = `2026-08-07T${String(hour).padStart(2, "0")}:15:00.000Z`;
		return [priceSlot(start, end, price)];
	});
	return {
		...stubDailyPlan(),
		slots,
		totals: { ...stubDailyPlan().totals, pvForecastEnergyKwh: 18 },
	};
}

describe("PRICE-REPLAN-001 cheap window shifts, median similar", () => {
	it("triggers replan when cheapest region moves", () => {
		// Median alike (~22), cheap block morning vs afternoon
		const a = dayPricePlan([
			{ hour: 8, price: 12 },
			{ hour: 9, price: 12 },
			{ hour: 10, price: 12 },
			{ hour: 14, price: 28 },
			{ hour: 15, price: 28 },
			{ hour: 16, price: 28 },
			{ hour: 12, price: 22 },
		]);
		const b = dayPricePlan([
			{ hour: 8, price: 28 },
			{ hour: 9, price: 28 },
			{ hour: 10, price: 28 },
			{ hour: 14, price: 12 },
			{ hour: 15, price: 12 },
			{ hour: 16, price: 12 },
			{ hour: 12, price: 22 },
		]);
		const sa = priceStructureDigestFromPlan(a);
		const sb = priceStructureDigestFromPlan(b);
		assert.notEqual(sa, sb);
		const d = evaluateMaterialReplan(
			baseline({
				priceMedianCt: 22,
				priceStructureDigest: sa,
				cadenceDigest: unifiedPlanCadenceDigest(a),
			}),
			actual({
				priceMedianCt: 22,
				priceStructureDigest: sb,
				cadenceDigest: unifiedPlanCadenceDigest(b),
			}),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_PRICE_REVISION));
	});
});

describe("PRICE-REPLAN-002 micro price noise", () => {
	it("no replan for tiny moves without structure change", () => {
		const a = dayPricePlan([
			{ hour: 10, price: 20 },
			{ hour: 11, price: 21 },
			{ hour: 12, price: 22 },
			{ hour: 13, price: 23 },
		]);
		const b = dayPricePlan([
			{ hour: 10, price: 20.4 },
			{ hour: 11, price: 21.3 },
			{ hour: 12, price: 22.2 },
			{ hour: 13, price: 23.1 },
		]);
		assert.equal(priceStructureDigestFromPlan(a), priceStructureDigestFromPlan(b));
		assert.equal(unifiedPlanCadenceDigest(a), unifiedPlanCadenceDigest(b));
		const d = evaluateMaterialReplan(
			baseline({
				priceStructureDigest: priceStructureDigestFromPlan(a),
				cadenceDigest: unifiedPlanCadenceDigest(a),
			}),
			actual({
				priceMedianCt: 22,
				priceStructureDigest: priceStructureDigestFromPlan(b),
				cadenceDigest: unifiedPlanCadenceDigest(b),
				batterySocPct: 40.2,
			}),
		);
		assert.equal(d.shouldReplan, false);
	});
});

describe("PRICE-REPLAN-003 cheap slot timing shifts", () => {
	it("replan when cheap hours move at similar day median", () => {
		const a = dayPricePlan([
			{ hour: 6, price: 10 },
			{ hour: 7, price: 24 },
			{ hour: 8, price: 24 },
			{ hour: 9, price: 24 },
			{ hour: 18, price: 24 },
		]);
		const b = dayPricePlan([
			{ hour: 6, price: 24 },
			{ hour: 7, price: 24 },
			{ hour: 8, price: 24 },
			{ hour: 9, price: 24 },
			{ hour: 18, price: 10 },
		]);
		assert.notEqual(priceStructureDigestFromPlan(a), priceStructureDigestFromPlan(b));
		const d = evaluateMaterialReplan(
			baseline({
				priceMedianCt: 24,
				priceStructureDigest: priceStructureDigestFromPlan(a),
				cadenceDigest: "x",
			}),
			actual({
				priceMedianCt: 24,
				priceStructureDigest: priceStructureDigestFromPlan(b),
				cadenceDigest: "x", // structure alone must suffice
			}),
		);
		assert.equal(d.shouldReplan, true);
		assert.ok(d.reasons.includes(REASON.REPLAN_PRICE_REVISION));
	});
});

describe("PV revision context + day evaluation structure", () => {
	it("previous/new/realized/remaining without double-counting", () => {
		const ctx = pvRevisionContext(
			baseline({ expectedPvDayKwh: 30, realizedPvKwhAtPlan: 8 }),
			actual({ forecastPvDayKwh: 17, realizedPvKwh: 8 }),
		);
		assert.equal(ctx.previousExpectedDayKwh, 30);
		assert.equal(ctx.newExpectedDayKwh, 17);
		assert.equal(ctx.realizedKwh, 8);
		assert.equal(ctx.remainingExpectedKwh, 9);
	});

	it("day evaluation draft is serializable for later learning", () => {
		const draft = buildDayEvaluationDraft({
			date: "2026-08-07",
			timezone: "Europe/Berlin",
			now: new Date("2026-08-07T22:00:00.000Z"),
			expectedPvKwh: 30,
			actualPvKwh: 22,
			expectedHouseLoadKwh: 12,
			actualHouseLoadKwh: 13,
			expectedGridImportKwh: 4,
			actualGridImportKwh: 5,
			expectedGridExportKwh: 8,
			actualGridExportKwh: 3,
			expectedImmersionKwh: 5,
			actualImmersionKwh: 4,
			expectedClimateKwh: 1,
			actualClimateKwh: 1.2,
			replanCount: 3,
			replanReasons: [REASON.REPLAN_PV_FORECAST_CHANGED],
			goalsMet: [{ consumerId: "immersion_heater", goalId: "thermal", met: true }],
		});
		assert.equal(draft.replanCount, 3);
		assert.ok(JSON.parse(JSON.stringify(draft)));
	});
});
