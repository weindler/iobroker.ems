/**
 * v0.2.23 — akzeptiertes Compare-`defer_tomorrow` sperrt nur Soft-IH über slotAllowed.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { operatorQuality } from "../../quality";
import { localDateKeyInTimezone } from "../../time";
import type { PlanContribution } from "../../types";
import { baseContribution, pvContributorRef } from "../../contributions/types";
import { addonContributorRef, systemContributorRef } from "../../contributor";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildUnifiedInputFromForecastContext } from "./from_forecast_context";
import { IMMERSION_HARD_CONSUMER_ID, IMMERSION_SOFT_CONSUMER_ID } from "./score_allocate";
import type { UnifiedForecastContext } from "./from_forecast_context";
import type { UnifiedDayPlan } from "./types";
import {
	acceptedImmersionSoftDisallowedSlotIsos,
	parseAiSlotPreferencesJson,
} from "../../../ai/strategy_preferences";

const Q = operatorQuality("valid", "test", 80);
const TZ = "Europe/Berlin";
const NOW = new Date("2026-06-15T08:00:00.000Z");
const EMPTY_AT_60H = "2026-06-17T20:00:00.000Z";
const HORIZON_HOURS = 40;

function contrib(id: string, opts: Partial<PlanContribution> & { details?: Record<string, unknown> }): PlanContribution {
	const { details = {}, ...rest } = opts;
	const contributor = id.startsWith("immersion")
		? addonContributorRef("immersion_heater")
		: id === CONTRIBUTION_IDS.PV_SUPPLY
			? pvContributorRef()
			: id === CONTRIBUTION_IDS.HOUSE_LOAD_FIXED
				? systemContributorRef("house_load")
				: systemContributorRef("grid_supply");
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
		targetTempC: 61.8,
		planningMinTempC: 44,
		mandatoryMinTempC: 50,
		planningMaxTempC: 63,
		requiredEnergyKwh: 1.7,
		maxPowerW: 1700,
		minPowerW: 1700,
		pvPrechargeActive: true,
		coolingRateCPerHAvg: null,
		estimatedEmptyAt: EMPTY_AT_60H,
		boilerEstimatedEmptyAt: EMPTY_AT_60H,
		emptyAtPlanningUsable: true,
		boilerEmptyAtUsable: true,
		boilerSensorDegraded: false,
		thermalLearningStatus: "ok",
		nightBridgeActive: false,
		hygieneDue: false,
		hygieneMandatoryKwh: null,
		...over,
	};
}

function buildContext(over: Partial<UnifiedForecastContext> & { ihDetails?: Record<string, unknown> } = {}): UnifiedForecastContext {
	const { ihDetails: ihOver, ...ctxOver } = over;
	const start = NOW.getTime();
	const slots = [];
	for (let i = 0; i < HORIZON_HOURS * 4; i++) {
		const a = new Date(start + i * 15 * 60_000).toISOString();
		const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
		const h = new Date(a).getUTCHours();
		const pv = h >= 6 && h < 18 ? 4000 : 40;
		const house = 300;
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
			validUntil: new Date(start + HORIZON_HOURS * 3600_000).toISOString(),
			revision: 1,
			timezone: TZ,
			horizonStart: slots[0]!.slot.startIso,
			horizonEnd: slots[slots.length - 1]!.slot.endIso,
			slotMinutes: 15 as const,
			status: "ready" as const,
			reasonDe: "test",
			quality: Q,
			days: [
				{
					date: "2026-06-15",
					pvEnergyKwh: 40,
					houseLoadEnergyKwh: 12,
					renewableBalanceKwh: 28,
					weatherMinTempC: null,
					weatherMaxTempC: null,
					quality: Q,
					reasonDe: "test",
				},
			],
			slots,
			contributions: [
				contrib(CONTRIBUTION_IDS.PV_SUPPLY, { details: { correctedTodayKwh: 40, rawTodayKwh: 40 } }),
				contrib(CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, { details: {} }),
				contrib(CONTRIBUTION_IDS.GRID_SUPPLY, { details: {} }),
				contrib(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
					deadlineIso: EMPTY_AT_60H,
					details: ihDetails(ihOver),
				}),
			],
			activeContributors: [],
			excludedContributors: [],
		},
		observedPvPowerW: 4200,
		observedHouseLoadPowerW: 400,
		observedPvAgeSec: 5,
		observedHouseAgeSec: 5,
		feedInCtPerKwh: 9.3,
		preferImmersionLiveSurplusNow: true,
		passiveBatteryEnergyAvailable: false,
		...ctxOver,
	} as UnifiedForecastContext;
}

function energyByConsumer(plan: UnifiedDayPlan, consumerId: string): number {
	return plan.allocations
		.filter((a) => a.consumerId === consumerId)
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

function energyOnLocalDay(plan: UnifiedDayPlan, consumerId: string, dateKey: string): number {
	let sum = 0;
	for (const a of plan.allocations) {
		if (a.consumerId !== consumerId) continue;
		if (localDateKeyInTimezone(new Date(a.slot.startIso), TZ) === dateKey) {
			sum += a.allocatedEnergyKwh;
		}
	}
	return sum;
}

function todaySlotIsos(ctx: UnifiedForecastContext): string[] {
	const todayKey = localDateKeyInTimezone(ctx.now, TZ);
	return ctx.forecastPlan.slots
		.filter((s) => localDateKeyInTimezone(new Date(s.slot.startIso), TZ) === todayKey)
		.map((s) => s.slot.startIso);
}

function tomorrowSlotIsos(ctx: UnifiedForecastContext): string[] {
	const todayKey = localDateKeyInTimezone(ctx.now, TZ);
	return ctx.forecastPlan.slots
		.filter((s) => localDateKeyInTimezone(new Date(s.slot.startIso), TZ) > todayKey)
		.map((s) => s.slot.startIso);
}

function retainedDeferPrefs(ctx: UnifiedForecastContext) {
	return [
		...todaySlotIsos(ctx).map((slotStartIso) => ({
			addonId: "immersion_heater",
			slotStartIso,
			weight: 0,
		})),
		...tomorrowSlotIsos(ctx)
			.slice(0, 8)
			.map((slotStartIso) => ({
				addonId: "immersion_heater",
				slotStartIso,
				weight: 3,
			})),
	];
}

describe("v0.2.23 accepted defer_tomorrow → Unified Soft slotAllowed", () => {
	it("akzeptiertes defer sperrt heutige Soft-IH-Slots, Live-Surplus umgeht das nicht", () => {
		const ctx = buildContext();
		const baseline = allocateUnifiedDayPlan(buildUnifiedInputFromForecastContext(ctx), { generation: 1 });
		assert.ok(
			energyOnLocalDay(baseline, IMMERSION_SOFT_CONSUMER_ID, "2026-06-15") > 0.2,
			"ohne Pref muss Soft heute planbar sein",
		);

		const disallowed = acceptedImmersionSoftDisallowedSlotIsos({
			activePlan: "b",
			prefs: retainedDeferPrefs(ctx),
		});
		assert.ok(disallowed.length > 0);
		const locked = allocateUnifiedDayPlan(
			buildUnifiedInputFromForecastContext({ ...ctx, immersionSoftDisallowedSlotIsos: disallowed }),
			{ generation: 1 },
		);
		assert.equal(
			energyOnLocalDay(locked, IMMERSION_SOFT_CONSUMER_ID, "2026-06-15"),
			0,
			"heute keine Soft-IH-Allokation",
		);
		assert.ok(
			energyOnLocalDay(locked, IMMERSION_SOFT_CONSUMER_ID, "2026-06-16") > 0.2,
			"morgen Soft-IH wieder planbar",
		);
		assert.equal(energyByConsumer(locked, IMMERSION_HARD_CONSUMER_ID), 0);
	});

	it("nicht akzeptierte oder gelöschte Preference hat keine Wirkung", () => {
		const ctx = buildContext();
		const prefs = retainedDeferPrefs(ctx);
		const rejected = acceptedImmersionSoftDisallowedSlotIsos({ activePlan: "a", prefs });
		assert.deepEqual(rejected, []);
		const cleared = parseAiSlotPreferencesJson("[]");
		assert.deepEqual(
			acceptedImmersionSoftDisallowedSlotIsos({ activePlan: "b", prefs: cleared }),
			[],
		);
		const plan = allocateUnifiedDayPlan(
			buildUnifiedInputFromForecastContext({ ...ctx, immersionSoftDisallowedSlotIsos: rejected }),
			{ generation: 1 },
		);
		assert.ok(energyOnLocalDay(plan, IMMERSION_SOFT_CONSUMER_ID, "2026-06-15") > 0.2);
	});

	it("stale/Folgetag-ISOs sperren heutige Soft-Slots nicht", () => {
		const ctx = buildContext();
		const stale = acceptedImmersionSoftDisallowedSlotIsos({
			activePlan: "b",
			prefs: [
				{ addonId: "immersion_heater", slotStartIso: "2026-06-14T08:00:00.000Z", weight: 0 },
				{ addonId: "immersion_heater", slotStartIso: "2026-06-14T12:00:00.000Z", weight: 0 },
			],
		});
		assert.equal(stale.length, 2);
		const plan = allocateUnifiedDayPlan(
			buildUnifiedInputFromForecastContext({ ...ctx, immersionSoftDisallowedSlotIsos: stale }),
			{ generation: 1 },
		);
		assert.ok(energyOnLocalDay(plan, IMMERSION_SOFT_CONSUMER_ID, "2026-06-15") > 0.2);
	});

	it("Hard/Mandatory bleibt trotz Soft-defer heute planbar", () => {
		const ctx = buildContext({
			ihDetails: {
				boilerTempC: 50,
				boilerMinTempC: 50,
				requiredEnergyKwh: 1.7,
			},
		});
		const disallowed = acceptedImmersionSoftDisallowedSlotIsos({
			activePlan: "b",
			prefs: retainedDeferPrefs(ctx),
		});
		const plan = allocateUnifiedDayPlan(
			buildUnifiedInputFromForecastContext({ ...ctx, immersionSoftDisallowedSlotIsos: disallowed }),
			{ generation: 1 },
		);
		assert.ok(
			energyOnLocalDay(plan, IMMERSION_HARD_CONSUMER_ID, "2026-06-15") >= 0.4,
			"Boiler-Min/Hard darf heute laufen",
		);
		assert.equal(energyOnLocalDay(plan, IMMERSION_SOFT_CONSUMER_ID, "2026-06-15"), 0);
	});
});
