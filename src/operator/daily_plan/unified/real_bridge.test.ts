import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { operatorQuality } from "../../quality";
import type { PlanContribution } from "../../types";
import { baseContribution, pvContributorRef } from "../../contributions/types";
import { addonContributorRef, systemContributorRef } from "../../contributor";
import type { OperatorContributorRef } from "../../types";
import { allocateUnifiedDayPlan } from "./allocate";
import { applyUnifiedIhAcAuthority } from "./authority";
import { buildUnifiedIhAcDispatchPublish } from "./dispatch_bridge";
import { buildUnifiedInputFromForecastContext } from "./from_forecast_context";
import { REASON } from "./reason_codes";
import { buildSlots } from "./fixtures";

const TZ = "Europe/Berlin";
const NOW = new Date("2026-08-07T10:07:00.000Z");

function contributorFor(id: string): OperatorContributorRef {
	if (id === CONTRIBUTION_IDS.PV_SUPPLY) return pvContributorRef();
	if (id === CONTRIBUTION_IDS.HOUSE_LOAD_FIXED) return systemContributorRef("house_load");
	if (id === CONTRIBUTION_IDS.GRID_SUPPLY) return systemContributorRef("grid_supply");
	if (id.startsWith("air_conditioning.")) return addonContributorRef("air_conditioning");
	if (id.startsWith("immersion_heater.")) return addonContributorRef("immersion_heater");
	if (id.startsWith("wallbox.")) return addonContributorRef("wallbox");
	return addonContributorRef("battery");
}

function contrib(
	id: string,
	opts: Partial<PlanContribution> & { details?: Record<string, unknown> },
): PlanContribution {
	const { details = {}, ...rest } = opts;
	return baseContribution(id, contributorFor(id), "consume", ["supply"], {
		generatedAt: NOW.toISOString(),
		validUntil: null,
		revision: 1,
		enabled: true,
		flexible: false,
		gridEligible: false,
		quality: operatorQuality("valid", "test", 80),
		reasonDe: "test",
		details,
		slots: [],
		...rest,
	});
}

function realisticSnapshot(overrides?: {
	pvStatus?: "valid" | "degraded" | "missing";
	pvLastUpdate?: string;
	rawToday?: number;
	correctedToday?: number;
	prices?: Array<number | null>;
	socPct?: number | null;
	capacity?: number | null;
	bufferTempC?: number | null;
	ihEnabled?: boolean;
	ihQuality?: "valid" | "blocked";
	connected?: boolean;
	vehicleSoc?: number | null;
	omitBattery?: boolean;
	omitPv?: boolean;
}) {
	// 4 Stunden → 16×15-Min-Slots (kompaktes Real-Snapshot-Fixture)
	const slots = buildSlots("2026-08-07T08:00:00.000Z", 4);
	const o = overrides ?? {};
	const prices = o.prices ?? slots.map((_, i) => 10 + (i % 5));
	const contributions: PlanContribution[] = [];
	if (!o.omitPv) {
		contributions.push(
			contrib(CONTRIBUTION_IDS.PV_SUPPLY, {
				quality: operatorQuality(o.pvStatus ?? "valid", "PV", 75),
				details: {
					rawTodayKwh: o.rawToday ?? 20,
					correctedTodayKwh: o.correctedToday ?? 18,
					rawTomorrowKwh: 15,
					correctedTomorrowKwh: 14,
					lastUpdateTs: o.pvLastUpdate ?? "2026-08-07T09:00:00.000Z",
					status: "ready",
					source: "learning.pv_bias",
				},
			}),
		);
	}
	contributions.push(
		contrib(CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, {
			quality: operatorQuality("valid", "Hauslast", 70),
			details: { lastUpdate: "2026-08-07T06:00:00.000Z" },
		}),
		contrib(CONTRIBUTION_IDS.GRID_SUPPLY, {
			quality: operatorQuality("valid", "Tibber", 90),
			details: { source: "dynamic_tariff" },
		}),
	);
	if (!o.omitBattery) {
		contributions.push(
			contrib(CONTRIBUTION_IDS.BATTERY_CHARGE, {
				details: {
					socPct: o.socPct === undefined ? 42 : o.socPct,
					maxChargePowerW: 4600,
				},
			}),
			contrib(CONTRIBUTION_IDS.BATTERY_RESERVE, {
				details: {
					minSocPct: 10,
					maxSocPct: 100,
					fault: false,
					lockout: false,
				},
			}),
		);
	}
	contributions.push(
		contrib(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
			enabled: o.ihEnabled !== false,
			quality: operatorQuality(o.ihQuality ?? "valid", "IH", 80),
			details: {
				bufferTempC: o.bufferTempC === undefined ? 48 : o.bufferTempC,
				targetTempC: 56,
				planningMinTempC: 48,
				planningMaxTempC: 60,
				maxPowerW: 1700,
				minPowerW: 1700,
				requiredEnergyKwh: 3,
				estimatedEmptyAt: "2026-08-07T22:00:00.000Z",
				coolingRateCPerHAvg: 0.4,
				minimumRuntimeSec: 60,
				reheatHysteresisK: 2,
			},
		}),
		contrib(CONTRIBUTION_IDS.AC_UNIT(1), {
			details: {
				name: "Wohnzimmer",
				roomTempC: 27,
				onTempC: 25,
				offTempC: 23,
				estimatedPowerW: 900,
				expectedKwhToday: 2.2,
			},
		}),
		contrib(CONTRIBUTION_IDS.WALLBOX_EV_SESSION, {
			enabled: o.connected === true,
			details: {
				connected: o.connected === true,
				vehicleSocPct: o.vehicleSoc === undefined ? null : o.vehicleSoc,
				requiredEnergyKwh: o.connected ? 12 : null,
				maxChargePowerW: 11000,
				planSocPct: 80,
			},
		}),
	);

	return {
		now: NOW,
		timezone: TZ,
		globalMode: "balanced",
		forecastPlan: {
			slots: slots.map((slot, i) => ({
				slot,
				pvPowerW: o.omitPv ? null : 2000 + i * 50,
				houseLoadPowerW: 800,
				fixedBalancePowerW: 1200,
				gridPriceCtPerKwh: prices[i] ?? null,
				gridImportAllowed: true,
				gridMaxImportPowerW: 11000,
				outdoorTempC: 22,
				quality: operatorQuality("valid", "slot", 80),
				reasonDe: "t",
			})),
			days: [
				{
					date: "2026-08-07",
					pvEnergyKwh: o.correctedToday ?? 18,
					houseLoadEnergyKwh: 12,
					renewableBalanceKwh: 6,
					weatherMinTempC: null,
					weatherMaxTempC: null,
					quality: operatorQuality("valid", "day", 80),
					reasonDe: "t",
				},
			],
			contributions,
		},
		bufferTempC: o.bufferTempC === undefined ? 48 : o.bufferTempC,
		batterySocPct: o.socPct === undefined ? 42 : o.socPct,
		batteryCapacityKwh: o.capacity === undefined ? 18 : o.capacity,
		batteryMaxChargePowerW: 4600,
		batteryMinSocPct: 10,
		batteryMaxSocPct: 100,
		roomTemps: { 1: 27 },
		contributionRevision: 99,
	};
}

describe("REAL-001 Real PV Mapping", () => {
	it("maps slots, bias once, freshness age", () => {
		const ctx = realisticSnapshot({
			rawToday: 20,
			correctedToday: 18,
			pvLastUpdate: "2026-08-07T09:00:00.000Z",
		});
		const input = buildUnifiedInputFromForecastContext(ctx);
		assert.equal(input.pv.slots.length, ctx.forecastPlan.slots.length);
		assert.equal(input.pv.slots[0].slot.startIso, ctx.forecastPlan.slots[0].slot.startIso);
		assert.equal(input.pv.biasCorrected, true);
		assert.equal(input.pv.biasPct, -10); // (18-20)/20
		assert.equal(input.pv.expectedDayEnergyKwh, 18);
		assert.ok(input.pv.freshness.ageSec !== null && input.pv.freshness.ageSec > 0);
		assert.equal(input.pv.freshness.observedAtIso, "2026-08-07T09:00:00.000Z");
		// Keine zweite Korrektur: Slot-Leistung = ForecastPlan (bereits korrigierte Form)
		assert.equal(input.pv.slots[0].forecastPowerW, ctx.forecastPlan.slots[0].pvPowerW);
	});
});

describe("REAL-002 Real Tibber Mapping", () => {
	it("maps price intervals without night hardcodes; null stays null", () => {
		const prices = [25, 20, null, 8, 12, 30, null, 15, 18, 22, 19, 16, 14, 11, 9, 7];
		const ctx = realisticSnapshot({ prices });
		const input = buildUnifiedInputFromForecastContext(ctx);
		assert.equal(input.prices.slots.length, 16);
		assert.equal(input.prices.slots[2].importCtPerKwh, null);
		assert.equal(input.prices.slots[3].importCtPerKwh, 8);
		assert.ok(input.prices.slots.every((s) => s.exportCtPerKwh === null));
		// Reihenfolge = Slot-Zeit
		for (let i = 1; i < input.prices.slots.length; i++) {
			assert.ok(input.prices.slots[i].slot.startIso > input.prices.slots[i - 1].slot.startIso);
		}
	});
});

describe("REAL-003 Real Battery Mapping", () => {
	it("SOC 0 is real zero; unknown stays null", () => {
		const zero = buildUnifiedInputFromForecastContext(
			realisticSnapshot({ socPct: 0, capacity: 18 }),
		);
		assert.equal(zero.battery.socPct, 0);
		assert.equal(zero.battery.usableCapacityKwh, 18);
		assert.equal(zero.battery.maxChargePowerW, 4600);
		assert.equal(zero.battery.minSocPct, 10);

		const unknown = buildUnifiedInputFromForecastContext(
			realisticSnapshot({ socPct: null, capacity: null, omitBattery: true }),
		);
		assert.equal(unknown.battery.socPct, null);
		assert.equal(unknown.battery.usableCapacityKwh, null);
		assert.equal(unknown.battery.uncertainty.status, "missing");
	});
});

describe("REAL-004 Real Thermal Mapping", () => {
	it("headroom from contribution requiredEnergyKwh; blocked clears flex", () => {
		const ok = buildUnifiedInputFromForecastContext(realisticSnapshot({ bufferTempC: 50 }));
		assert.ok(ok.thermal);
		assert.equal(ok.thermal!.bufferTempC, 50);
		assert.equal(ok.thermal!.dayTargetTempC, 56);
		// Fixture liefert Contribution-requiredEnergyKwh=3 (keine Bridge-eigene 0.38-Formel)
		assert.equal(ok.thermal!.headroomEnergyKwh, 3);

		const blocked = buildUnifiedInputFromForecastContext(
			realisticSnapshot({ ihQuality: "blocked", bufferTempC: 50 }),
		);
		assert.equal(blocked.thermal!.headroomEnergyKwh, 0);
		assert.equal(blocked.thermal!.uncertainty.status, "blocked");
	});
});

describe("REAL-005 Real AC Mapping", () => {
	it("maps unit comfort and power without inventing defaults", () => {
		const input = buildUnifiedInputFromForecastContext(realisticSnapshot());
		assert.ok(input.climate);
		assert.equal(input.climate!.units.length, 1);
		assert.equal(input.climate!.units[0].roomTempC, 27);
		assert.equal(input.climate!.units[0].mandatoryComfort, true);
		assert.equal(input.climate!.units[0].typicalPowerW, 900);
		assert.equal(input.climate!.units[0].expectedEnergyKwh, 2.2);
	});
});

describe("REAL-006 Vehicle Connected vs Unknown Presence", () => {
	it("connectedNow does not invent future presence as available", () => {
		const input = buildUnifiedInputFromForecastContext(
			realisticSnapshot({ connected: true, vehicleSoc: 40 }),
		);
		assert.ok(input.wallbox);
		assert.equal(input.wallbox!.connectedNow, true);
		assert.equal(input.wallbox!.presenceHardConstraint, true);
		assert.equal(input.wallbox!.vehicleSocPct, 40);
		assert.ok(input.wallbox!.presenceWindows.some((w) => w.source === "live_connected"));
		// Zukunft ohne History/Explicit → unknown, nicht still available
		assert.ok(
			input.wallbox!.presenceWindows.some(
				(w) => (w.status ?? (w.available ? "available" : "unavailable")) === "unknown",
			),
		);
		assert.equal(
			input.wallbox!.presenceWindows.some((w) => w.source === "predicted"),
			false,
		);
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(plan.reasonCodes.includes(REASON.VEHICLE_PRESENCE_UNKNOWN));

		const disc = buildUnifiedInputFromForecastContext(realisticSnapshot({ connected: false }));
		assert.equal(disc.wallbox!.connectedNow, false);
		assert.ok(disc.wallbox!.presenceWindows.some((w) => w.source === "live_disconnected"));
		assert.equal(
			disc.wallbox!.presenceWindows.some(
				(w) =>
					(w.status ?? (w.available ? "available" : "unavailable")) === "available" &&
					w.source !== "live_connected",
			),
			false,
		);
	});
});

describe("REAL-007 Missing Data degraded plan", () => {
	it("does not crash; emits degraded confidence and reason codes", () => {
		const input = buildUnifiedInputFromForecastContext(
			realisticSnapshot({
				omitPv: true,
				socPct: null,
				capacity: null,
				omitBattery: true,
				prices: [null, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null],
			}),
		);
		assert.equal(input.pv.uncertainty.status, "missing");
		const plan = allocateUnifiedDayPlan(input);
		assert.ok(plan.confidence.status === "degraded" || plan.confidence.status === "missing");
		assert.ok(plan.reasonCodes.includes(REASON.BATTERY_TELEMETRY_MISSING));
		assert.ok(plan.reasonCodes.includes(REASON.EXPORT_TARIFF_UNKNOWN));
		assert.equal(plan.batteryTrajectory.length, 0);
	});
});

describe("REAL-008 End-to-End Real Day Plan + IH/AC Authority", () => {
	it("snapshot → unified input → allocate → authority without second planner world", () => {
		const ctx = realisticSnapshot({ connected: true, vehicleSoc: 55 });
		const input = buildUnifiedInputFromForecastContext(ctx);
		const unified = allocateUnifiedDayPlan(input);
		assert.ok((unified.expectedPvEnergyTodayKwh ?? 0) > 0 || (unified.expectedPvEnergyHorizonKwh ?? 0) > 0);
		assert.ok(
			(unified.expectedHouseLoadEnergyTodayKwh ?? 0) > 0 ||
				(unified.expectedHouseLoadEnergyHorizonKwh ?? 0) > 0,
		);
		assert.equal(unified.inputRevision, 99);
		assert.ok(unified.allocations.some((a) => a.kind === "immersion_heater" || a.kind === "climate"));
		const pub = buildUnifiedIhAcDispatchPublish(unified);
		const classicLike = {
			generatedAt: NOW.toISOString(),
			validUntil: null,
			revision: 99,
			date: "2026-08-07",
			timezone: TZ,
			slotMinutes: 15 as const,
			globalMode: "balanced",
			status: "ready" as const,
			policySnapshot: {},
			constraintSnapshot: {},
			activeContributionIds: [],
			excludedContributions: [],
			slots: [],
			allocations: [],
			unallocated: [],
			totals: {
				pvForecastEnergyKwh: null,
				fixedHouseLoadEnergyKwh: null,
				fixedRenewableBalanceKwh: null,
				flexibleRequestedEnergyKwh: null,
				flexibleAllocatedEnergyKwh: 0,
				flexibleUnallocatedEnergyKwh: null,
				pvAllocatedEnergyKwh: 0,
				gridAllocatedEnergyKwh: 0,
				batteryChargeEnergyKwh: 0,
				wallboxEnergyKwh: 0,
				immersionHeaterEnergyKwh: 0,
				airConditioningEnergyKwh: 0,
				estimatedGridCostCt: null,
				mandatoryRequestedEnergyKwh: null,
				mandatoryAllocatedEnergyKwh: 0,
				mandatoryUnallocatedEnergyKwh: null,
			},
			quality: operatorQuality("valid", "t", 80),
			reasonDe: "classic",
		};
		const merged = applyUnifiedIhAcAuthority(classicLike, pub.immersionEntries, pub.climateEntries, {
			dailyPlanRevision: 99,
			unifiedPlanId: unified.planId,
		});
		assert.ok(merged.allocations.every((a) => a.reasonDe.includes("unified_day_plan") || a.reasonDe.includes("daily_plan_rev=99")));
		// Battery/Wallbox slices not taken over for live — only IH/AC in authority merge here
		assert.equal(merged.allocations.filter((a) => a.contributionId.startsWith("battery.")).length, 0);
	});
});
