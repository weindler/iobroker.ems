/**
 * One-Plan-Kernfall: Boiler am Minimum, nur Newton-Modell (keine abgeschlossenen Zyklen),
 * frisch überfälliges estimated_empty_at (Boiler erreicht Minimum gerade jetzt). PV-Überschuss
 * jetzt vorhanden, danach Nacht ohne PV. Der Planner muss den Heizstab JETZT priorisieren
 * (Vorplanen), statt "ohne emptyAt" auf 0 zu fallen und Klima den ganzen Überschuss geben zu
 * lassen. Integrationsebene für die Kette Contribution-Details → Unified-Bridge → Allocator
 * (die feingranulare Learning→Contribution-Ableitung ist separat in thermal_learning.test.ts
 * und flexible.test.ts abgedeckt — dort schlagen die Tests ohne die jeweiligen Fixes fehl).
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CONTRIBUTION_IDS } from "../../contribution_ids";
import { operatorQuality } from "../../quality";
import type { PlanContribution } from "../../types";
import { baseContribution, pvContributorRef } from "../../contributions/types";
import { addonContributorRef, systemContributorRef } from "../../contributor";
import { allocateUnifiedDayPlan } from "./allocate";
import { buildUnifiedInputFromForecastContext } from "./from_forecast_context";
import type { UnifiedForecastContext } from "./from_forecast_context";
import type { UnifiedDayPlannerInput } from "./types";

const Q = operatorQuality("valid", "test", 80);
const TZ = "Europe/Berlin";
/** 16:00 Ortszeit (CEST, UTC+2) — genau der Nutzer-Realfall. */
const NOW = new Date("2026-08-19T14:00:00.000Z");

function contrib(id: string, details: Record<string, unknown>): PlanContribution {
	const contributor = id.startsWith("immersion")
		? addonContributorRef("immersion_heater")
		: id.startsWith("air_conditioning")
			? addonContributorRef("air_conditioning")
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
	});
}

/**
 * PV-Überschuss jetzt (~16:00–18:00 Ortszeit), dann Nacht ohne PV, nächster verlässlicher
 * PV-Slot erst morgen ab ~08:00 Ortszeit — exakt das Nutzer-Szenario ("es ist 16 Uhr, dann
 * kommt die Nacht, da habe ich keine PV").
 */
function buildContext(
	overrideIhDetails: Record<string, unknown>,
	withCompetingClimate = false,
): UnifiedForecastContext {
	const slots = [];
	const start = Date.parse(NOW.toISOString());
	for (let i = 0; i < 96; i++) {
		const a = new Date(start + i * 15 * 60_000).toISOString();
		const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
		const h = new Date(a).getUTCHours();
		// UTC 14-16 == CEST 16-18 (Rest-PV heute); UTC 6-14 morgen == CEST 8-16 (PV morgen).
		const isTodayEveningPv = i < 8; // erste 2h ab NOW
		const isTomorrowMorningPv = h >= 6 && h < 14 && i >= 8;
		const pv = isTodayEveningPv ? 3000 : isTomorrowMorningPv ? 3500 : 0;
		const house = 400;
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
			validUntil: new Date(start + 48 * 3600_000).toISOString(),
			revision: 1,
			timezone: TZ,
			horizonStart: NOW.toISOString(),
			horizonEnd: slots[slots.length - 1]!.slot.endIso,
			slotMinutes: 15 as const,
			status: "ready" as const,
			reasonDe: "test",
			quality: Q,
			days: [
				{
					date: "2026-08-19",
					pvEnergyKwh: 26.7,
					houseLoadEnergyKwh: 13,
					renewableBalanceKwh: 13.7,
					weatherMinTempC: null,
					weatherMaxTempC: null,
					quality: Q,
					reasonDe: "test",
				},
			],
			slots,
			contributions: [
				contrib(CONTRIBUTION_IDS.PV_SUPPLY, { correctedTodayKwh: 26.7, rawTodayKwh: 26.7 }),
				contrib(CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, {}),
				contrib(CONTRIBUTION_IDS.GRID_SUPPLY, {}),
				contrib(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
					bufferTempC: 50,
					boilerTempC: 50,
					boilerMinTempC: 50,
					targetTempC: 52.8,
					forecastTargetTempC: 52.8,
					planningMinTempC: 44,
					mandatoryMinTempC: 50,
					planningMaxTempC: 63,
					requiredEnergyKwh: 5.8,
					maxPowerW: 1700,
					minPowerW: 1700,
					pvPrechargeActive: false,
					coolingRateCPerHAvg: null,
					coolingConstantPerH: 0.00477,
					coolingAsymptoteC: 18,
					bufferEstimatedEmptyAt: null,
					boilerSensorDegraded: false,
					thermalLearningStatus: "missing",
					thermalLearningModel: "newton",
					nightBridgeActive: false,
					...overrideIhDetails,
				}),
				...(withCompetingClimate
					? [
							contrib(CONTRIBUTION_IDS.AC_UNIT(1), {
								name: "unit_1",
								roomTempC: 27,
								onTempC: 26,
								offTempC: 24,
								/** Mandatory comfort (room >= onTemp) — konkurriert real um denselben PV-Überschuss. */
								estimatedPowerW: 2500,
								expectedKwhToday: 5,
							}),
						]
					: []),
			],
			activeContributors: [],
			excludedContributors: [],
		},
		observedPvPowerW: 3000,
		observedHouseLoadPowerW: 400,
		observedPvAgeSec: 5,
		observedHouseAgeSec: 5,
		feedInCtPerKwh: 9.3,
		preferImmersionLiveSurplusNow: true,
		passiveBatteryEnergyAvailable: true,
	} as UnifiedForecastContext;
}

function sumIhKwh(plan: { allocations: { kind: string; allocatedEnergyKwh: number }[] }): number {
	return plan.allocations
		.filter((a) => a.kind === "immersion_heater")
		.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
}

describe("Boiler-Minimum + Newton-only (One-Plan-Kernfall — Vorplanen vor Nacht ohne PV)", () => {
	it("boiler AT minimum with usable Newton emptyAt: immersion heater gets a hard slot now, not zero", () => {
		const emptyAtIso = new Date(NOW.getTime() - 4 * 60_000).toISOString(); // frisch überfällig (Boiler jetzt am Min)
		const context = buildContext({
			boilerEstimatedEmptyAt: emptyAtIso,
			estimatedEmptyAt: emptyAtIso,
			emptyAtSource: "estimated",
			emptyAtPlanningUsable: true,
		});
		const input = buildUnifiedInputFromForecastContext(context);

		// Bridge muss die überfällige, aber frische Schätzung als usable durchreichen.
		assert.equal(input.thermal?.boilerEmptyAtUsable, true);
		assert.equal(input.thermal?.boilerTempC, 50);

		const plan = allocateUnifiedDayPlan(input as UnifiedDayPlannerInput);
		const ih = plan.allocations.filter((a) => a.kind === "immersion_heater");
		assert.ok(sumIhKwh(plan) > 0, `expected immersion heater energy > 0, got ${sumIhKwh(plan)}`);

		// Muss JETZT (im aktuellen PV-Fenster, vor der Nacht) geplant werden — Vorplanen, kein
		// "wartet auf geplanten Slot" bis morgen.
		const nowWindowIh = ih.filter((a) => Date.parse(a.slot.startIso) < NOW.getTime() + 2 * 3600_000);
		assert.ok(
			nowWindowIh.length > 0,
			`expected immersion heater allocation within the current PV window before night, starts=${ih.map((a) => a.slot.startIso).join(",")}`,
		);
	});

	it("without usable emptyAt (regression guard): boiler-at-min hard guard still forces a minimal slot", () => {
		const context = buildContext({
			boilerEstimatedEmptyAt: null,
			estimatedEmptyAt: null,
			emptyAtSource: null,
			emptyAtPlanningUsable: false,
		});
		const input = buildUnifiedInputFromForecastContext(context);
		assert.equal(input.thermal?.boilerEmptyAtUsable, false);

		const plan = allocateUnifiedDayPlan(input as UnifiedDayPlannerInput);
		assert.ok(sumIhKwh(plan) > 0, `hard guard (boilerAtOrNearMinNow) must still force a slot`);
	});

	it("boiler-min Pflicht must not be starved to zero by a competing mandatory-comfort climate unit", () => {
		const emptyAtIso = new Date(NOW.getTime() - 4 * 60_000).toISOString();
		const context = buildContext(
			{
				boilerEstimatedEmptyAt: emptyAtIso,
				estimatedEmptyAt: emptyAtIso,
				emptyAtSource: "estimated",
				emptyAtPlanningUsable: true,
			},
			true,
		);
		const input = buildUnifiedInputFromForecastContext(context);
		const plan = allocateUnifiedDayPlan(input as UnifiedDayPlannerInput);
		const ihKwh = sumIhKwh(plan);
		const acKwh = plan.allocations
			.filter((a) => a.kind === "climate")
			.reduce((s, a) => s + a.allocatedEnergyKwh, 0);
		assert.ok(
			ihKwh > 0,
			`Boiler-Minimum ist Pflichtbedarf (Lastenheft §5.4) — darf nicht auf 0 fallen, nur weil Klima gleichzeitig will (AC=${acKwh} kWh, IH=${ihKwh} kWh)`,
		);
	});
});
