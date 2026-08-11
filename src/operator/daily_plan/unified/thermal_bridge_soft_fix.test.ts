/**
 * v0.1.263 — Hard-Bridge vs Soft-Precharge + Newton-Verdrahtung + Realfall 10.08.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { operatorQuality } from "../../quality";
import type { PlanContribution } from "../../types";
import { baseContribution } from "../../contributions/types";
import { addonContributorRef, systemContributorRef } from "../../contributor";
import { pvContributorRef } from "../../contributions/types";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildUnifiedInputFromForecastContext } from "./from_forecast_context";
import {
	findEndOfCurrentSurplusWindowIdx,
	findNextReliablePvAfterCurrentWindow,
	resolveThermalPlannerEnergy,
} from "./next_reliable_pv";
import { effectiveCoolingRateCPerH } from "../../contributions/flexible/thermal_cooling_rate";
import { IMMERSION_HARD_CONSUMER_ID, IMMERSION_SOFT_CONSUMER_ID } from "./score_allocate";
import type { UnifiedDayPlannerInput } from "./types";
import type { UnifiedForecastContext } from "./from_forecast_context";

const Q = operatorQuality("valid", "test", 80);
const TZ = "Europe/Berlin";
const NOW = new Date("2026-08-10T08:45:35.859Z");

function contrib(
	id: string,
	opts: Partial<PlanContribution> & { details?: Record<string, unknown> },
): PlanContribution {
	const { details = {}, ...rest } = opts;
	const contributor = id.startsWith("immersion")
		? addonContributorRef("immersion_heater")
		: id === CONTRIBUTION_IDS.PV_SUPPLY
			? pvContributorRef()
			: id === CONTRIBUTION_IDS.HOUSE_LOAD_FIXED
				? systemContributorRef("house_load")
				: id === CONTRIBUTION_IDS.GRID_SUPPLY
					? systemContributorRef("grid_supply")
					: addonContributorRef("battery");
	return baseContribution(id, contributor, "consume", ["demand_flex"], {
		generatedAt: NOW.toISOString(),
		validUntil: null,
		revision: 1,
		enabled: true,
		flexible: true,
		gridEligible: false,
		quality: Q,
		reasonDe: "test",
		details,
		slots: [],
		...rest,
	});
}

function ihDetails(over: Record<string, unknown> = {}): Record<string, unknown> {
	return {
		bufferTempC: 54,
		boilerTempC: 58,
		boilerMinTempC: 50,
		targetTempC: 61.803,
		forecastTargetTempC: 51.6,
		planningMinTempC: 44,
		mandatoryMinTempC: 50,
		planningMaxTempC: 63,
		requiredEnergyKwh: 2.965,
		maxPowerW: 1700,
		minPowerW: 1700,
		pvPrechargeActive: true,
		pvPrechargeExtraK: 10.2,
		/** Puffer-Newton nur Soft — nicht Hard-usable. */
		coolingRateCPerHAvg: null,
		coolingConstantPerH: 0.08853,
		coolingAsymptoteC: 40.35,
		bufferEstimatedEmptyAt: "2026-08-10T18:56:50.898Z",
		boilerEstimatedEmptyAt: null,
		estimatedEmptyAt: null,
		emptyAtSource: null,
		emptyAtPlanningUsable: false,
		boilerSensorDegraded: false,
		thermalLearningStatus: "degraded",
		thermalLearningModel: "newton",
		nightBridgeActive: false,
		...over,
	};
}

function realCaseContext() {
	const slots = [];
	const start = Date.parse("2026-08-10T08:45:00.000Z");
	for (let i = 0; i < 96; i++) {
		const a = new Date(start + i * 15 * 60_000).toISOString();
		const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
		const h = new Date(a).getUTCHours();
		let pv = h >= 8 && h < 18 ? 3500 : h === 18 ? 2800 : 0;
		let house = pv > 500 ? 400 : 300;
		if (i === 0) {
			pv = 4652;
			house = 1940;
		}
		slots.push({
			slot: { startIso: a, endIso: b },
			pvPowerW: pv,
			houseLoadPowerW: house,
			fixedBalancePowerW: pv - house,
			gridPriceCtPerKwh: 25,
			gridImportAllowed: true,
			gridMaxImportPowerW: 30000,
			outdoorTempC: null,
			quality: Q,
			reasonDe: "",
		});
	}
	return {
		now: NOW,
		timezone: TZ,
		globalMode: "balanced" as const,
		forecastPlan: {
			generatedAt: NOW.toISOString(),
			validUntil: "2026-08-12T08:45:00.000Z",
			revision: 1,
			timezone: TZ,
			horizonStart: "2026-08-10T08:45:00.000Z",
			horizonEnd: slots[slots.length - 1]!.slot.endIso,
			slotMinutes: 15 as const,
			status: "ready" as const,
			reasonDe: "test",
			quality: Q,
			days: [
				{
					date: "2026-08-10",
					pvEnergyKwh: 40.2,
					houseLoadEnergyKwh: 14.9,
					renewableBalanceKwh: 25.3,
					weatherMinTempC: null,
					weatherMaxTempC: null,
					quality: Q,
					reasonDe: "test",
				},
			],
			slots,
			contributions: [
				contrib(CONTRIBUTION_IDS.PV_SUPPLY, {
					details: { correctedTodayKwh: 40.2, rawTodayKwh: 40.2 },
				}),
				contrib(CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, { details: {} }),
				contrib(CONTRIBUTION_IDS.GRID_SUPPLY, { details: {} }),
				contrib(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
					deadlineIso: "2026-08-10T18:56:50.898Z",
					details: ihDetails(),
				}),
			],
			activeContributors: [],
			excludedContributors: [],
		},
		observedPvPowerW: 4652,
		observedHouseLoadPowerW: 1940,
		observedPvAgeSec: 5,
		observedHouseAgeSec: 5,
		feedInCtPerKwh: 9.3,
		preferImmersionLiveSurplusNow: true,
		passiveBatteryEnergyAvailable: true,
	} as UnifiedForecastContext;
}

function sumIh(plan: { allocations: { kind: string; allocatedEnergyKwh: number }[] }): number {
	return plan.allocations
		.filter((a) => a.kind === "immersion_heater")
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

describe("v0.1.268 thermal cooling / Boiler-Puffer-Trennung (T1)", () => {
	it("Puffer-Newton berechenbar; Hard nutzt Boiler (kein Buffer-emptyAt)", () => {
		const rate = effectiveCoolingRateCPerH({
			coolingRateCPerHAvg: null,
			coolingConstantPerH: 0.08853,
			coolingAsymptoteC: 40.35,
			bufferTempC: 54,
			minTempC: 44,
			estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
			nowMs: Date.parse("2026-08-10T08:45:00.000Z"),
		});
		assert.ok(rate != null && rate > 0.5, `newton instant rate got ${rate}`);
		const input = buildUnifiedInputFromForecastContext(realCaseContext());
		assert.equal(input.thermal?.coolingRateCPerH, null);
		assert.equal(input.thermal?.boilerMinTempC ?? input.thermal?.minTempC, 50);
		assert.equal(input.thermal?.boilerTempC, 58);
		assert.equal(input.thermal?.boilerEmptyAtUsable, false);
		assert.equal(input.thermal?.forecastTargetTempC, 51.6);
		assert.equal(input.thermal?.dayTargetTempC, 61.803);
		assert.equal(input.thermal?.pvPrechargeActive, true);
	});
});

describe("v0.1.268 hard bridge vs soft — Boiler Hard / Puffer Soft", () => {
	it("T2: Boiler über Min, Learning nicht usable → hard ~0, Soft aus Headroom", () => {
		const r = resolveThermalPlannerEnergy({
			nowMs: Date.parse("2026-08-10T08:45:00.000Z"),
			bufferTempC: 54,
			boilerTempC: 58,
			minTempC: 50,
			boilerMinTempC: 50,
			bufferMaxTempC: 63,
			headroomEnergyKwh: 2.965,
			coolingRateCPerH: 1.21,
			estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
			boilerEmptyAtUsable: false,
			nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
			currentWindowEndMs: Date.parse("2026-08-10T18:30:00.000Z"),
			pvConfidence01: 0.81,
		});
		assert.equal(r.coversUntilNextPv, true);
		assert.ok(r.mandatoryEnergyKwh < 0.2, `hard got ${r.mandatoryEnergyKwh}`);
		assert.ok(r.economicHeadroomKwh >= 2.7, `soft got ${r.economicHeadroomKwh}`);
	});

	it("T3: Boiler unter Cover mit usable Learning → hard > 0, nicht full headroom", () => {
		const r = resolveThermalPlannerEnergy({
			nowMs: Date.parse("2026-08-10T16:00:00.000Z"),
			bufferTempC: 55,
			boilerTempC: 51,
			minTempC: 50,
			boilerMinTempC: 50,
			bufferMaxTempC: 63,
			headroomEnergyKwh: 2.0,
			coolingRateCPerH: 0.8,
			estimatedEmptyAtMs: Date.parse("2026-08-10T17:00:00.000Z"),
			boilerEmptyAtUsable: true,
			nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
			currentWindowEndMs: Date.parse("2026-08-10T18:30:00.000Z"),
			pvConfidence01: 0.85,
		});
		assert.equal(r.coversUntilNextPv, false);
		assert.ok(r.mandatoryEnergyKwh > 0.2, `hard got ${r.mandatoryEnergyKwh}`);
		assert.ok(r.mandatoryEnergyKwh < 2.0, `hard must not swallow full headroom`);
	});

	it("T6: Boiler nahe Min + usable cooling → hard shortfall vor Fensterende", () => {
		const r = resolveThermalPlannerEnergy({
			nowMs: Date.parse("2026-08-10T12:00:00.000Z"),
			bufferTempC: 55,
			boilerTempC: 50.2,
			minTempC: 50,
			boilerMinTempC: 50,
			bufferMaxTempC: 63,
			headroomEnergyKwh: 1.0,
			coolingRateCPerH: 0.6,
			estimatedEmptyAtMs: Date.parse("2026-08-10T12:30:00.000Z"),
			boilerEmptyAtUsable: true,
			nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
			currentWindowEndMs: Date.parse("2026-08-10T18:00:00.000Z"),
			pvConfidence01: 0.9,
		});
		assert.ok(r.mandatoryEnergyKwh > 0.1);
		assert.equal(r.coversUntilNextPv, false);
	});
});

describe("v0.1.263 current PV window (T4)", () => {
	it("remaining current window end is used as cover — not only tomorrow", () => {
		const slots = [];
		const start = Date.parse("2026-08-10T08:45:00.000Z");
		for (let i = 0; i < 48; i++) {
			const a = new Date(start + i * 15 * 60_000).toISOString();
			const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
			const h = new Date(a).getUTCHours();
			const pv = h >= 8 && h < 18 ? 0.75 : 0;
			slots.push({
				startIso: a,
				endIso: b,
				startMs: Date.parse(a),
				pvKwh: pv,
				houseKwh: 0.1,
				importCt: 25,
			});
		}
		const endIdx = findEndOfCurrentSurplusWindowIdx(slots, 0);
		assert.ok(endIdx > 1, `window end idx ${endIdx}`);
		const windowEndMs = Date.parse(slots[endIdx - 1]!.endIso);
		const next = findNextReliablePvAfterCurrentWindow(slots, 0, 0.85, start);
		/** Cover über Fensterende: hard ~0 trotz nextPv morgen (Boiler warm, Learning nicht usable). */
		const rWindow = resolveThermalPlannerEnergy({
			nowMs: start,
			bufferTempC: 54,
			boilerTempC: 58,
			minTempC: 50,
			boilerMinTempC: 50,
			bufferMaxTempC: 63,
			headroomEnergyKwh: 2.965,
			coolingRateCPerH: 1.2,
			estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
			boilerEmptyAtUsable: false,
			nextReliablePvMs: next.startMs ?? Date.parse("2026-08-11T05:00:00.000Z"),
			currentWindowEndMs: windowEndMs,
			pvConfidence01: 0.85,
		});
		const rTomorrowOnly = resolveThermalPlannerEnergy({
			nowMs: start,
			bufferTempC: 54,
			boilerTempC: 58,
			minTempC: 50,
			boilerMinTempC: 50,
			bufferMaxTempC: 63,
			headroomEnergyKwh: 2.965,
			coolingRateCPerH: 1.2,
			estimatedEmptyAtMs: Date.parse("2026-08-10T18:56:50.898Z"),
			boilerEmptyAtUsable: false,
			nextReliablePvMs: Date.parse("2026-08-11T05:00:00.000Z"),
			currentWindowEndMs: null,
			pvConfidence01: 0.85,
		});
		assert.equal(rWindow.coversUntilNextPv, true);
		assert.ok(rWindow.mandatoryEnergyKwh < 0.25);
		assert.ok(
			rTomorrowOnly.mandatoryEnergyKwh >= rWindow.mandatoryEnergyKwh,
			`window cover must not invent more hard than tomorrow-only path`,
		);
	});
});

describe("v0.1.268 real-case regression 2026-08-10 ~10:45", () => {
	it("hard ≠ full 2.965; soft; no buffer-emptyAt evening pile-up", () => {
		const input = buildUnifiedInputFromForecastContext(realCaseContext());
		input.battery = {
			...input.battery,
			socPct: 100,
			usableCapacityKwh: 18,
			minSocPct: 10,
			maxSocPct: 100,
			endSocTargetPct: 100,
			requiredChargeEnergyKwh: 0,
			nightReserveKwh: 2.5,
			passiveBatteryEnergyAvailable: true,
			allowedModes: input.battery.allowedModes ?? ["pv"],
			uncertainty: Q,
			freshness: {
				observedAtIso: input.time.nowIso,
				ageSec: 0,
				quality: Q,
			},
		};

		assert.equal(input.thermal?.coolingRateCPerH, null);
		assert.equal(input.thermal?.boilerTempC, 58);
		assert.equal(input.thermal?.boilerEmptyAtUsable, false);

		const plan = allocateUnifiedDayPlan(input as UnifiedDayPlannerInput);
		const ih = plan.allocations.filter((a) => a.kind === "immersion_heater");
		const evening = ih.filter((a) => new Date(a.slot.startIso).getUTCHours() >= 16);
		const early = ih.filter((a) => new Date(a.slot.startIso).getUTCHours() < 16);

		const goal = plan.goalStatuses.find((g) => g.consumerId === "immersion_heater");
		assert.ok(
			goal?.detailDe &&
				(goal.detailDe.includes("Soft") ||
					goal.detailDe.includes("Precharge") ||
					goal.detailDe.includes("Hard") ||
					goal.detailDe.includes("Headroom")),
			goal?.detailDe,
		);

		if (ih.length >= 2) {
			assert.ok(
				early.length >= 1,
				`expected early soft placement, early=${early.length} evening=${evening.length} starts=${ih.map((a) => a.slot.startIso).join(",")}`,
			);
		}
		assert.ok(sumIh(plan) <= 3.1);
		if (ih.length > 0) {
			const first = Date.parse(ih[0]!.slot.startIso);
			assert.ok(
				first <= Date.parse("2026-08-10T14:00:00.000Z"),
				`first IH should not be evening-only, got ${ih[0]!.slot.startIso}`,
			);
		}
	});
});

describe("v0.1.263 soft upgrade when later PV disappears (T5)", () => {
	it("without current window hard bridge can rise vs with window", () => {
		const withPv = resolveThermalPlannerEnergy({
			nowMs: Date.parse("2026-08-10T10:00:00.000Z"),
			bufferTempC: 50,
			minTempC: 48,
			headroomEnergyKwh: 1.5,
			coolingRateCPerH: 0.5,
			estimatedEmptyAtMs: Date.parse("2026-08-10T16:00:00.000Z"),
			nextReliablePvMs: Date.parse("2026-08-11T06:00:00.000Z"),
			currentWindowEndMs: Date.parse("2026-08-10T17:00:00.000Z"),
			pvConfidence01: 0.85,
		});
		const withoutWindow = resolveThermalPlannerEnergy({
			nowMs: Date.parse("2026-08-10T10:00:00.000Z"),
			bufferTempC: 50,
			minTempC: 48,
			headroomEnergyKwh: 1.5,
			coolingRateCPerH: 0.5,
			estimatedEmptyAtMs: Date.parse("2026-08-10T16:00:00.000Z"),
			nextReliablePvMs: Date.parse("2026-08-11T06:00:00.000Z"),
			currentWindowEndMs: null,
			pvConfidence01: 0.85,
		});
		assert.ok(
			withoutWindow.mandatoryEnergyKwh >= withPv.mandatoryEnergyKwh,
			`without window hard ${withoutWindow.mandatoryEnergyKwh} vs with ${withPv.mandatoryEnergyKwh}`,
		);
	});
});

describe("v0.1.263 consumer split ids", () => {
	it("exports hard/soft consumer ids", () => {
		assert.equal(IMMERSION_HARD_CONSUMER_ID, "immersion_heater");
		assert.equal(IMMERSION_SOFT_CONSUMER_ID, "immersion_heater_soft");
	});
});
