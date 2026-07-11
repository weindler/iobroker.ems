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
import { buildDailyHorizonSlots, energyKwhFromPower, slotStartIsoFloored } from "./slots";
import { runAllocation, buildAllocationCandidates } from "./allocation";
import { buildDailyPlan, buildDailyPlanFromForecast, dailyPlanRevisionPayload } from "./build";
import { buildDailyPlanSlots } from "./constraints";
import type { ForecastPlan } from "../forecast/types";

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

describe("daily plan slots", () => {
	it("floors to 15 minute boundary", () => {
		assert.equal(slotStartIsoFloored(NOW, TZ), "2026-07-11T10:00:00.000Z");
	});

	it("builds horizon until local day end", () => {
		const slots = buildDailyHorizonSlots(NOW, TZ, 15);
		assert.ok(slots.length > 0);
		assert.ok(slots[0].startIso >= "2026-07-11T10:00:00.000Z");
		assert.equal(slots[slots.length - 1].endIso, "2026-07-12T00:00:00.000Z");
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
});

describe("grid import effective", () => {
	it("blocks when policy disallows", () => {
		assert.equal(gridImportEffective(true, false, true, "balanced"), false);
	});

	it("blocks when global mode off", () => {
		assert.equal(gridImportEffective(true, true, true, "off"), false);
	});
});
