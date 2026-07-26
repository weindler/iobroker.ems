import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { operatorQuality } from "../quality";
import { addonContributorRef } from "../contributor";
import { CONTRIBUTION_IDS } from "../contribution_ids";
import type { PlanContribution } from "../types";
import { baseContribution } from "../contributions/types";
import {
	buildAllocationCandidate,
	compareAllocationCandidates,
	gridImportEffective,
	isMutualExclusionPair,
	matchesPolicyRef,
	policyOrderFor,
} from "./policy";
import { availablePvSurplus, remainingGridImportForSlot, effectiveImportLimitW } from "./constraints";
import {
	buildDailyHorizonSlots,
	DAILY_PLAN_HORIZON_HOURS,
	energyKwhFromPower,
	slotStartIsoFloored,
} from "./slots";
import { runAllocation, buildAllocationCandidates } from "./allocation";
import { buildDailyPlan, buildDailyPlanFromForecast, dailyPlanRevisionPayload } from "./build";
import { buildDailyPlanSlots } from "./constraints";
import type { ForecastPlan } from "../forecast/types";
import { buildForecastPlan } from "../forecast/build";
import { buildPvContribution } from "../contributions/pv";
import { buildHouseLoadContribution } from "../contributions/house_load";
import { buildWeatherContribution } from "../contributions/weather";
import { buildGridSupplyContribution } from "../contributions/constraints";

const NOW = new Date("2026-07-11T10:07:00.000Z");
const TZ = "UTC";

function flexContribution(
	contributionId: string,
	addonId: string,
	overrides: Partial<Omit<PlanContribution, "details">> & { details?: Record<string, unknown> } = {},
): PlanContribution {
	const { details = {}, ...rest } = overrides;
	return baseContribution(
		contributionId,
		addonContributorRef(addonId as "battery"),
		"consume",
		["demand_flex"],
		{
			generatedAt: NOW.toISOString(),
			validUntil: null,
			revision: 1,
			enabled: true,
			flexible: true,
			gridEligible: true,
			quality: operatorQuality("valid", "OK"),
			reasonDe: "OK",
			details,
			slots: [],
			...rest,
		},
	);
}

function forecastSlot(
	startIso: string,
	endIso: string,
	opts: {
		pv?: number | null;
		load?: number | null;
		price?: number | null;
		importAllowed?: boolean;
	} = {},
) {
	const pv = opts.pv ?? null;
	const load = opts.load ?? null;
	const balance = pv !== null && load !== null ? pv - load : null;
	return {
		slot: { startIso, endIso },
		pvPowerW: pv,
		houseLoadPowerW: load,
		fixedBalancePowerW: balance,
		gridPriceCtPerKwh: opts.price ?? null,
		gridImportAllowed: opts.importAllowed ?? true,
		gridMaxImportPowerW: 11000,
		outdoorTempC: null,
		quality: operatorQuality("valid", "OK"),
		reasonDe: "test",
	};
}

function minimalForecast(overrides: Partial<ForecastPlan> = {}): ForecastPlan {
	return {
		generatedAt: NOW.toISOString(),
		validUntil: null,
		revision: 1,
		timezone: TZ,
		horizonStart: NOW.toISOString(),
		horizonEnd: "2026-07-12T00:00:00.000Z",
		slotMinutes: 15,
		status: "ready",
		activeContributors: [],
		excludedContributors: [],
		days: [
			{
				date: "2026-07-11",
				pvEnergyKwh: 20,
				houseLoadEnergyKwh: 10,
				renewableBalanceKwh: 10,
				weatherMinTempC: null,
				weatherMaxTempC: null,
				quality: operatorQuality("valid", "OK"),
				reasonDe: "OK",
			},
		],
		slots: [],
		contributions: [],
		quality: operatorQuality("valid", "OK"),
		reasonDe: "OK",
		...overrides,
	};
}

describe("daily plan policy", () => {
	it("matches contribution id before addon id in priority", () => {
		const order = policyOrderFor(
			"immersion_heater.mandatory",
			"immersion_heater",
			["wallbox", "immersion_heater.mandatory", "battery"],
		);
		assert.equal(order, 1);
	});

	it("uses alphabetical tie-breaker via compareAllocationCandidates", () => {
		const a = buildAllocationCandidate(
			flexContribution("battery.charge", "battery"),
			"balanced",
			[],
		);
		const b = buildAllocationCandidate(
			flexContribution("wallbox.ev_session", "wallbox"),
			"balanced",
			[],
		);
		assert.ok(compareAllocationCandidates(a, b) < 0);
	});

	it("detects mutual exclusion pairs", () => {
		assert.ok(
			isMutualExclusionPair("battery", "wallbox", [{ addonA: "battery", addonB: "wallbox" }]),
		);
	});

	it("matches policy refs", () => {
		assert.ok(matchesPolicyRef("battery.charge", "battery.charge", "battery"));
		assert.ok(matchesPolicyRef("battery", "battery.charge", "battery"));
	});
});

describe("daily plan constraints", () => {
	it("computes pv surplus only when balance positive", () => {
		assert.equal(availablePvSurplus(3000), 3000);
		assert.equal(availablePvSurplus(-500), 0);
		assert.equal(availablePvSurplus(null), null);
	});

	it("remaining grid import subtracts house load", () => {
		assert.equal(remainingGridImportForSlot(11000, 3000), 8000);
	});

	it("returns null grid remaining when house load unknown", () => {
		assert.equal(remainingGridImportForSlot(11000, null), null);
	});

	it("effective import limit uses minimum of limits", () => {
		assert.equal(effectiveImportLimitW(11000, 9000), 9000);
	});
});

describe("daily plan end-to-end: PV shape + house-load segments reach Daily Plan slots", () => {
	it("regression: pvForecastPowerW/fixedHouseLoadPowerW are no longer null once PV shape + house-load segments are configured", () => {
		const now = new Date("2026-07-11T10:00:00.000Z");
		const tz = "UTC";

		const pv = buildPvContribution({
			now,
			correctedTodayKwh: 15,
			correctedTomorrowKwh: 18,
			rawTodayKwh: 14,
			rawTomorrowKwh: 17,
			confidencePct: 80,
			status: "ready",
			lastUpdateTs: now.toISOString(),
			source: "learning.pv_bias",
			horizonDays: [
				{ dayIndex: 0, dateKey: "2026-07-11", correctedKwh: 15, confidencePct: 80 },
				{ dayIndex: 1, dateKey: "2026-07-12", correctedKwh: 18, confidencePct: 80 },
			],
			shape: { timezone: tz, latDeg: 48.14, lonDeg: 11.58, hourlyPoints: [], capW: null },
		});

		const house = buildHouseLoadContribution({
			now,
			timezone: tz,
			status: "ready",
			confidence: 70,
			forecastToday: {
				date: "2026-07-11",
				season: "summer",
				weekday: "saturday",
				day_type: "weekend",
				segments: {
					midday: { avg_w: 800, source: "p", fallback_level: "none", confidence: 70 },
					afternoon: { avg_w: 600, source: "p", fallback_level: "none", confidence: 70 },
					evening: { avg_w: 400, source: "p", fallback_level: "none", confidence: 70 },
				},
			},
			forecastTomorrow: null,
			lastUpdate: now.toISOString(),
		});

		const weather = buildWeatherContribution({
			now,
			learningStatus: "ready",
			learningHealth: "ok",
			confidencePct: 90,
			lastUpdate: now.toISOString(),
			forecastSource: "test",
			actualSource: "test",
			outdoorTempC: 22,
			cloudPct: 10,
			hourlyPoints: [],
			todayMinTempC: 18,
			todayMaxTempC: 24,
			tomorrowMinTempC: null,
			tomorrowMaxTempC: null,
			forecastHorizonStart: now.toISOString(),
			forecastHorizonEnd: null,
		});

		const grid = buildGridSupplyContribution({
			generatedAt: now.toISOString(),
			validUntil: null,
			source: "dynamic_tariff",
			currentPriceCtPerKwh: 24,
			gridImportAllowed: true,
			configuredMaxGridImportW: 11000,
			configuredHouseFuseLimitW: 13800,
			effectiveMaxGridImportW: 11000,
			slots: [
				{
					startIso: "2026-07-11T10:00:00.000Z",
					endIso: "2026-07-11T10:15:00.000Z",
					priceCtPerKwh: 20,
					importAllowed: true,
					maxImportPowerW: 11000,
					priceLabel: "normal",
					quality: operatorQuality("valid", "OK"),
				},
			],
			quality: operatorQuality("valid", "Grid OK"),
			reasonDe: "Grid OK",
		});

		const forecastPlan = buildForecastPlan({ now, timezone: tz, contributions: [pv, house, weather, grid] });
		assert.equal(forecastPlan.status, "ready");

		const plan = buildDailyPlanFromForecast(now, tz, "balanced", forecastPlan, {
			policySnapshot: null,
			energyPriority: [],
			mutualExclusions: [],
			gridImportAllowedPolicy: true,
			effectiveMaxGridImportW: 11000,
			configuredHouseFuseLimitW: 13800,
			modePolicy: { mode: "balanced", allowOptimization: true },
		});

		const firstSlot = plan.slots[0];
		assert.equal(firstSlot.slot.startIso, "2026-07-11T10:00:00.000Z");
		assert.notEqual(firstSlot.pvForecastPowerW, null);
		assert.notEqual(firstSlot.fixedHouseLoadPowerW, null);
		assert.equal(firstSlot.fixedHouseLoadPowerW, 800);
		assert.notEqual(firstSlot.fixedBalancePowerW, null);
		assert.notEqual(firstSlot.availablePvSurplusPowerW, null);
		assert.equal(plan.slots.length, DAILY_PLAN_HORIZON_HOURS * 4);
		assert.equal(plan.validUntil, "2026-07-13T10:00:00.000Z");
		// Segmente gelten für den konfigurierten Tag (heute); rollierender 48h-Horizont
		// enthält Folgetage ohne Hauslast-Segmente in diesem Fixture → nur Tag 0 prüfen.
		for (const s of plan.slots.filter((x) => x.slot.startIso.startsWith("2026-07-11"))) {
			const hourUtc = new Date(s.slot.startIso).getUTCHours();
			const expected = hourUtc < 14 ? 800 : hourUtc < 18 ? 600 : 400;
			assert.equal(s.fixedHouseLoadPowerW, expected, `slot ${s.slot.startIso} should inherit its segment value`);
		}
	});
});

describe("daily plan forecast merge across resolutions", () => {
	const hourStart = "2026-07-11T06:00:00.000Z";
	const q1Start = "2026-07-11T06:00:00.000Z";
	const q1End = "2026-07-11T06:15:00.000Z";
	const q2Start = "2026-07-11T06:15:00.000Z";
	const q2End = "2026-07-11T06:30:00.000Z";
	const q3Start = "2026-07-11T06:30:00.000Z";
	const q3End = "2026-07-11T06:45:00.000Z";
	const q4Start = "2026-07-11T06:45:00.000Z";
	const q4End = "2026-07-11T07:00:00.000Z";
	const hourEnd = q4End;

	it("projects a multi-hour house-load segment onto every contained 15-min slot", () => {
		const slots = buildDailyPlanSlots(
			[
				{ startIso: q1Start, endIso: q1End },
				{ startIso: q2Start, endIso: q2End },
				{ startIso: q3Start, endIso: q3End },
				{ startIso: q4Start, endIso: q4End },
			],
			[
				// 4h segment baseline (e.g. house-load learning), does not align with 15-min keys
				forecastSlot(hourStart, hourEnd, { load: 500 }),
				// exact 15-min price slot only for the first quarter (e.g. grid supply)
				forecastSlot(q1Start, q1End, { price: 25 }),
			],
			11000,
			13800,
		);

		assert.equal(slots.length, 4);
		for (const s of slots) {
			assert.equal(s.fixedHouseLoadPowerW, 500, `expected house load in slot ${s.slot.startIso}`);
		}
		assert.equal(slots[0].gridPriceCtPerKwh, 25);
		assert.equal(slots[1].gridPriceCtPerKwh, null);
		assert.equal(slots[2].gridPriceCtPerKwh, null);
		assert.equal(slots[3].gridPriceCtPerKwh, null);
	});

	it("does not leak a segment's value onto slots outside its window", () => {
		const outsideStart = "2026-07-11T07:00:00.000Z";
		const outsideEnd = "2026-07-11T07:15:00.000Z";
		const slots = buildDailyPlanSlots(
			[{ startIso: outsideStart, endIso: outsideEnd }],
			[forecastSlot(hourStart, hourEnd, { load: 500 })],
			11000,
			13800,
		);
		assert.equal(slots[0].fixedHouseLoadPowerW, null);
	});

	it("still computes fixedBalancePowerW when pv and house load come from different-resolution sources", () => {
		const slots = buildDailyPlanSlots(
			[{ startIso: q1Start, endIso: q1End }],
			[
				forecastSlot(hourStart, hourEnd, { load: 500 }),
				forecastSlot(q1Start, q1End, { pv: 2000 }),
			],
			11000,
			13800,
		);
		assert.equal(slots[0].pvForecastPowerW, 2000);
		assert.equal(slots[0].fixedHouseLoadPowerW, 500);
		assert.equal(slots[0].fixedBalancePowerW, 1500);
		assert.equal(slots[0].availablePvSurplusPowerW, 1500);
	});

	it("prefers the more precise (smaller) overlapping slot when sources overlap", () => {
		const slots = buildDailyPlanSlots(
			[{ startIso: q1Start, endIso: q1End }],
			[
				forecastSlot(hourStart, hourEnd, { load: 500 }),
				forecastSlot(q1Start, q1End, { load: 640 }),
			],
			11000,
			13800,
		);
		assert.equal(slots[0].fixedHouseLoadPowerW, 640);
	});
});

describe("daily plan slots", () => {
	it("floors to 15 minute boundary", () => {
		assert.equal(slotStartIsoFloored(NOW, TZ), "2026-07-11T10:00:00.000Z");
	});

	it("builds rolling horizon of at least 48 hours (Block 5)", () => {
		const slots = buildDailyHorizonSlots(NOW, TZ, 15);
		assert.ok(slots.length > 0);
		assert.equal(slots[0].startIso, "2026-07-11T10:00:00.000Z");
		assert.equal(slots[slots.length - 1].endIso, "2026-07-13T10:00:00.000Z");
		assert.equal(slots.length, DAILY_PLAN_HORIZON_HOURS * 4);
	});
});

describe("daily plan allocation", () => {
	const slot1Start = "2026-07-11T10:00:00.000Z";
	const slot1End = "2026-07-11T10:15:00.000Z";
	const slot2Start = "2026-07-11T10:15:00.000Z";
	const slot2End = "2026-07-11T10:30:00.000Z";

	it("allocates battery charge from pv surplus", () => {
		const slots = buildDailyPlanSlots(
			[
				{ startIso: slot1Start, endIso: slot1End },
				{ startIso: slot2Start, endIso: slot2End },
			],
			[
				forecastSlot(slot1Start, slot1End, { pv: 5000, load: 1000, price: 20 }),
				forecastSlot(slot2Start, slot2End, { pv: 4000, load: 1000, price: 30 }),
			],
			11000,
			13800,
		);

		const battery = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.BATTERY_CHARGE, "battery", {
				details: { requiredEnergyKwh: 2 },
				slots: [{ slot: { startIso: slot1Start, endIso: slot1End }, maxPowerW: 5000, requiredEnergyKwh: 2, available: true, mandatory: false, minPowerW: null, preferredPowerW: null, availableEnergyKwh: null, priceCtPerKwh: null, quality: operatorQuality("valid", "OK") }],
			}),
			"balanced",
			["battery"],
		);

		const result = runAllocation({
			slots,
			candidates: [battery],
			globalMode: "balanced",
			modeAllowsOptimization: true,
			gridImportAllowedPolicy: true,
			mutualExclusions: [],
			nowMs: NOW.getTime(),
		});

		assert.ok(result.allocations.length > 0);
		assert.ok(result.allocations.some((a) => a.energySource === "pv_surplus"));
	});

	it("excludes disconnected wallbox without error", () => {
		const c = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.WALLBOX_EV_SESSION, "wallbox", {
				enabled: false,
				quality: operatorQuality("disabled", "Fahrzeug nicht verbunden."),
			}),
			"balanced",
			[],
		);
		assert.equal(c.allocatable, false);
	});

	it("excludes unsupported battery discharge", () => {
		const c = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.BATTERY_DISCHARGE, "battery", {
				flow: "provide",
				enabled: false,
				quality: operatorQuality("unsupported", "unsupported"),
			}),
			"balanced",
			[],
		);
		assert.equal(c.allocationStatus, "unsupported");
	});

	it("respects mutual exclusion for grid in same slot", () => {
		const slots = buildDailyPlanSlots(
			[{ startIso: slot1Start, endIso: slot1End }],
			[forecastSlot(slot1Start, slot1End, { pv: 0, load: 1000, price: 10 })],
			11000,
			13800,
		);

		const battery = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.BATTERY_CHARGE, "battery", {
				details: { requiredEnergyKwh: 1 },
			}),
			"balanced",
			["battery", "wallbox"],
		);
		const wallbox = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.WALLBOX_EV_SESSION, "wallbox", {
				details: { requiredEnergyKwh: 1 },
			}),
			"balanced",
			["battery", "wallbox"],
		);

		const result = runAllocation({
			slots,
			candidates: [battery, wallbox],
			globalMode: "balanced",
			modeAllowsOptimization: true,
			gridImportAllowedPolicy: true,
			mutualExclusions: [{ id: "x", addonA: "battery", addonB: "wallbox" }],
			nowMs: NOW.getTime(),
		});

		const gridInSlot = result.allocations.filter(
			(a) => a.slot.startIso === slot1Start && a.gridPowerW > 0,
		);
		assert.ok(gridInSlot.length <= 1);
	});

	it("global mode off documents mandatory without allocation", () => {
		const slots = buildDailyPlanSlots(
			[{ startIso: slot1Start, endIso: slot1End }],
			[forecastSlot(slot1Start, slot1End, { pv: 5000, load: 1000 })],
			11000,
			13800,
		);
		const mandatory = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.IMMERSION_MANDATORY, "immersion_heater", {
				details: { requiredEnergyKwh: 3, mandatory: true },
			}),
			"off",
			[],
		);
		mandatory.mandatory = true;

		const result = runAllocation({
			slots,
			candidates: [mandatory],
			globalMode: "off",
			modeAllowsOptimization: false,
			gridImportAllowedPolicy: true,
			mutualExclusions: [],
			nowMs: NOW.getTime(),
		});
		assert.equal(result.allocations.length, 0);
		assert.ok(result.unallocated.length > 0);
	});

	it("immersion flexible pv-first gets no grid", () => {
		const slots = buildDailyPlanSlots(
			[{ startIso: slot1Start, endIso: slot1End }],
			[forecastSlot(slot1Start, slot1End, { pv: 0, load: 1000, price: 5 })],
			11000,
			13800,
		);
		const flex = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
				gridEligible: false,
				details: { requiredEnergyKwh: 2, pvFirst: true },
			}),
			"balanced",
			[],
		);
		flex.pvFirst = true;
		flex.gridEligible = false;

		const result = runAllocation({
			slots,
			candidates: [flex],
			globalMode: "balanced",
			modeAllowsOptimization: true,
			gridImportAllowedPolicy: true,
			mutualExclusions: [],
			nowMs: NOW.getTime(),
		});
		assert.ok(result.allocations.every((a) => a.gridPowerW === 0));
	});

	it("skips micro allocations below minPowerW (no 8 W Schein-Slots)", () => {
		const slots = buildDailyPlanSlots(
			[
				{ startIso: slot1Start, endIso: slot1End },
				{ startIso: "2026-07-11T10:15:00.000Z", endIso: "2026-07-11T10:30:00.000Z" },
			],
			[
				forecastSlot(slot1Start, slot1End, { pv: 5000, load: 1000 }),
				forecastSlot("2026-07-11T10:15:00.000Z", "2026-07-11T10:30:00.000Z", { pv: 5000, load: 1000 }),
			],
			11000,
			13800,
		);
		// 0.1 kWh → ceil zu 400 W < 1700 W Mindeststufe → keine Allocation.
		const flex = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
				gridEligible: false,
				details: { requiredEnergyKwh: 0.1, maxPowerW: 1700, minPowerW: 1700, pvFirst: true },
			}),
			"balanced",
			[],
		);
		assert.equal(flex.minPowerW, 1700);

		const result = runAllocation({
			slots,
			candidates: [flex],
			globalMode: "balanced",
			modeAllowsOptimization: true,
			gridImportAllowedPolicy: true,
			mutualExclusions: [],
			nowMs: NOW.getTime(),
		});
		assert.equal(result.allocations.length, 0);
		assert.ok(result.unallocated.some((u) => u.contributionId === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE));
	});

	it("allocates only slots that can carry at least minPowerW", () => {
		const slots = buildDailyPlanSlots(
			[
				{ startIso: slot1Start, endIso: slot1End },
				{ startIso: "2026-07-11T10:15:00.000Z", endIso: "2026-07-11T10:30:00.000Z" },
			],
			[
				forecastSlot(slot1Start, slot1End, { pv: 1500, load: 1000 }), // surplus 500 < 1700
				forecastSlot("2026-07-11T10:15:00.000Z", "2026-07-11T10:30:00.000Z", { pv: 4000, load: 1000 }), // 3000
			],
			11000,
			13800,
		);
		const flex = buildAllocationCandidate(
			flexContribution(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
				gridEligible: false,
				details: { requiredEnergyKwh: 0.5, maxPowerW: 1700, minPowerW: 1700, pvFirst: true },
			}),
			"balanced",
			[],
		);

		const result = runAllocation({
			slots,
			candidates: [flex],
			globalMode: "balanced",
			modeAllowsOptimization: true,
			gridImportAllowedPolicy: true,
			mutualExclusions: [],
			nowMs: NOW.getTime(),
		});
		assert.ok(result.allocations.length >= 1);
		assert.ok(result.allocations.every((a) => (a.allocatedPowerW ?? 0) >= 1700));
		assert.ok(result.allocations.every((a) => a.slot.startIso !== slot1Start));
	});
});

describe("daily plan build", () => {
	it("builds full plan from forecast", () => {
		const slot1Start = "2026-07-11T10:00:00.000Z";
		const slot1End = "2026-07-11T10:15:00.000Z";
		const forecast = minimalForecast({
			slots: [forecastSlot(slot1Start, slot1End, { pv: 6000, load: 2000, price: 18 })],
			contributions: [
				flexContribution(CONTRIBUTION_IDS.BATTERY_CHARGE, "battery", {
					details: { requiredEnergyKwh: 1 },
				}),
			],
		});

		const plan = buildDailyPlanFromForecast(NOW, TZ, "balanced", forecast, {
			policySnapshot: null,
			energyPriority: ["battery"],
			mutualExclusions: [],
			gridImportAllowedPolicy: true,
			effectiveMaxGridImportW: 11000,
			configuredHouseFuseLimitW: 13800,
			modePolicy: { mode: "balanced", allowOptimization: true },
		});

		assert.equal(plan.date, "2026-07-11");
		assert.equal(plan.slotMinutes, 15);
		assert.ok(plan.slots.length > 0);
		assert.equal(plan.status, "ready");
	});

	it("revision payload ignores generatedAt", () => {
		const forecast = minimalForecast();
		const plan1 = buildDailyPlanFromForecast(NOW, TZ, "balanced", forecast, {
			policySnapshot: null,
			energyPriority: [],
			mutualExclusions: [],
			gridImportAllowedPolicy: true,
			effectiveMaxGridImportW: 11000,
			configuredHouseFuseLimitW: 13800,
			modePolicy: { mode: "balanced", allowOptimization: true },
		});
		const plan2 = { ...plan1, generatedAt: new Date("2026-07-11T10:05:00.000Z").toISOString() };
		assert.equal(dailyPlanRevisionPayload(plan1), dailyPlanRevisionPayload(plan2));
	});

	it("computes grid cost when price present", () => {
		const e = energyKwhFromPower(2000, 15);
		assert.ok(e > 0);
		const cost = e * 20;
		assert.ok(cost > 0);
	});

	it("missing forecast inputs yields missing_inputs status", () => {
		const forecast = minimalForecast({ status: "missing_inputs" });
		const plan = buildDailyPlanFromForecast(NOW, TZ, "balanced", forecast, {
			policySnapshot: null,
			energyPriority: [],
			mutualExclusions: [],
			gridImportAllowedPolicy: true,
			effectiveMaxGridImportW: 11000,
			configuredHouseFuseLimitW: 13800,
			modePolicy: { mode: "balanced", allowOptimization: true },
		});
		assert.equal(plan.status, "missing_inputs");
	});

	it("flexibleRequestedEnergyKwh totals dedupe per contribution across allocation rows", () => {
		const s1 = "2026-07-11T10:00:00.000Z";
		const e1 = "2026-07-11T10:15:00.000Z";
		const s2 = "2026-07-11T10:15:00.000Z";
		const e2 = "2026-07-11T10:30:00.000Z";
		const s3 = "2026-07-11T10:30:00.000Z";
		const e3 = "2026-07-11T10:45:00.000Z";
		const forecast = minimalForecast({
			slots: [
				forecastSlot(s1, e1, { pv: 3000, load: 500 }),
				forecastSlot(s2, e2, { pv: 3000, load: 500 }),
				forecastSlot(s3, e3, { pv: 3000, load: 500 }),
			],
			contributions: [
				flexContribution(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, "immersion_heater", {
					details: { requiredEnergyKwh: 1 },
				}),
			],
		});
		const plan = buildDailyPlanFromForecast(NOW, TZ, "balanced", forecast, {
			policySnapshot: null,
			energyPriority: ["immersion_heater"],
			mutualExclusions: [],
			gridImportAllowedPolicy: true,
			effectiveMaxGridImportW: 11000,
			configuredHouseFuseLimitW: 13800,
			modePolicy: { mode: "balanced", allowOptimization: true },
		});
		const ihRows = plan.allocations.filter(
			(a) => a.contributionId === CONTRIBUTION_IDS.IMMERSION_FLEXIBLE,
		);
		assert.ok(ihRows.length >= 2, "expected multi-slot IH allocation for regression");
		assert.equal(plan.totals.flexibleRequestedEnergyKwh, 1);
	});
});

describe("grid import effective", () => {
	it("blocks when policy disallows", () => {
		assert.equal(gridImportEffective(true, false, true, "balanced"), false);
	});

	it("blocks when global mode off", () => {
		assert.equal(gridImportEffective(true, true, true, "off"), false);
	});
});
