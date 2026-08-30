/**
 * BLOCK B — Thermal Opportunity im echten Unified Planner (Ende-zu-Ende).
 *
 * Prüft, dass der optionale Soft-Heizstab-Anteil bei einem deutlich besseren, sicher
 * erreichbaren PV-Fenster vor `thermalEmptyAtIso` tatsächlich dorthin verschoben wird —
 * und dass er NICHT über `thermalEmptyAtIso` hinaus wartet, wenn die Deadline näher liegt
 * als das bessere Fenster.
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
import { IMMERSION_HARD_CONSUMER_ID, IMMERSION_SOFT_CONSUMER_ID } from "./score_allocate";
import type { UnifiedForecastContext } from "./from_forecast_context";
import type { UnifiedDayPlan } from "./types";
import { REASON } from "./reason_codes";

const Q = operatorQuality("valid", "test", 80);
const TZ = "Europe/Berlin";
const NOW = new Date("2026-06-15T08:00:00.000Z");
const HORIZON_HOURS = 7; // 08:00–15:00 — bewusst kein "Nacht"-Nullertail, sonst verdünnt er
// die Perzentil-Basis für die Slots davor (dieselbe Methode wie Block A: Perzentil über die
// GESAMTE bekannte Slot-Reihe, siehe thermal_opportunity_gate.ts).

function contrib(id: string, opts: Partial<PlanContribution> & { details?: Record<string, unknown> }): PlanContribution {
	const { details = {}, ...rest } = opts;
	const contributor =
		id.startsWith("immersion")
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

/**
 * PV-Profil mit einem schwachen Fenster kurz nach NOW (08:00–10:00) und einem deutlich
 * besseren Fenster später (11:00–15:00), danach Abfall. `emptyAtIso` steuert, ob das
 * bessere Fenster noch vor der thermischen Deadline liegt.
 */
function buildContext(args: {
	estimatedEmptyAtIso: string;
	requiredEnergyKwh: number;
	hygieneDue?: boolean;
	hygieneMandatoryKwh?: number;
}): UnifiedForecastContext {
	const start = NOW.getTime();
	const slots = [];
	for (let i = 0; i < HORIZON_HOURS * 4; i++) {
		const a = new Date(start + i * 15 * 60_000).toISOString();
		const b = new Date(start + (i + 1) * 15 * 60_000).toISOString();
		const h = new Date(a).getUTCHours();
		let pv: number;
		if (h >= 8 && h < 11) pv = 2500; // schwaches, aber technisch nutzbares Fenster (Surplus > minPowerW)
		else if (h >= 11 && h < 15) pv = 4000; // deutlich besseres Fenster
		else pv = 50;
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
			validUntil: new Date(start + 24 * 3600_000).toISOString(),
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
					pvEnergyKwh: 20,
					houseLoadEnergyKwh: 8,
					renewableBalanceKwh: 12,
					weatherMinTempC: null,
					weatherMaxTempC: null,
					quality: Q,
					reasonDe: "test",
				},
			],
			slots,
			contributions: [
				contrib(CONTRIBUTION_IDS.PV_SUPPLY, { details: { correctedTodayKwh: 20, rawTodayKwh: 20 } }),
				contrib(CONTRIBUTION_IDS.HOUSE_LOAD_FIXED, { details: {} }),
				contrib(CONTRIBUTION_IDS.GRID_SUPPLY, { details: {} }),
				contrib(CONTRIBUTION_IDS.IMMERSION_FLEXIBLE, {
					deadlineIso: args.estimatedEmptyAtIso,
					details: {
						bufferTempC: 54,
						boilerTempC: 58,
						boilerMinTempC: 50,
						targetTempC: 61.8,
						planningMinTempC: 44,
						mandatoryMinTempC: 50,
						planningMaxTempC: 63,
						requiredEnergyKwh: args.requiredEnergyKwh,
						maxPowerW: 1700,
						minPowerW: 1700,
						pvPrechargeActive: true,
						coolingRateCPerHAvg: null,
						estimatedEmptyAt: args.estimatedEmptyAtIso,
						emptyAtPlanningUsable: false,
						boilerSensorDegraded: false,
						thermalLearningStatus: "missing",
						nightBridgeActive: false,
						hygieneDue: args.hygieneDue === true,
						hygieneMandatoryKwh: args.hygieneMandatoryKwh ?? null,
					},
				}),
			],
			activeContributors: [],
			excludedContributors: [],
		},
		observedPvPowerW: null,
		observedHouseLoadPowerW: null,
		observedPvAgeSec: null,
		observedHouseAgeSec: null,
		feedInCtPerKwh: 9.3,
		preferImmersionLiveSurplusNow: false,
		passiveBatteryEnergyAvailable: false,
	} as UnifiedForecastContext;
}

function energyBySlotStart(plan: UnifiedDayPlan, consumerId: string): Map<string, number> {
	const map = new Map<string, number>();
	for (const a of plan.allocations) {
		if (a.consumerId !== consumerId) continue;
		map.set(a.slot.startIso, (map.get(a.slot.startIso) ?? 0) + a.allocatedEnergyKwh);
	}
	return map;
}

function softEnergyBySlotStart(plan: UnifiedDayPlan): Map<string, number> {
	return energyBySlotStart(plan, IMMERSION_SOFT_CONSUMER_ID);
}

function energyInRange(map: Map<string, number>, fromHourUtc: number, toHourUtc: number): number {
	let sum = 0;
	for (const [startIso, kwh] of map) {
		const h = new Date(startIso).getUTCHours();
		if (h >= fromHourUtc && h < toHourUtc) sum += kwh;
	}
	return sum;
}

describe("Block B — Thermal Opportunity im Unified Planner (Ende-zu-Ende)", () => {
	it("wartet mit dem optionalen Soft-Anteil auf das deutlich bessere PV-Fenster (Deadline danach)", () => {
		const ctx = buildContext({
			estimatedEmptyAtIso: "2026-06-15T16:00:00.000Z", // nach dem besseren Fenster (11–15 Uhr)
			requiredEnergyKwh: 0.85, // = 2 volle Slots bei minPowerW=maxPowerW=1700 W (0.425 kWh/Slot)
		});
		const input = buildUnifiedInputFromForecastContext(ctx);
		const plan = allocateUnifiedDayPlan(input, { generation: 1 });
		const soft = softEnergyBySlotStart(plan);
		const early = energyInRange(soft, 8, 11);
		const later = energyInRange(soft, 11, 15);
		assert.ok(later > early, `erwartet spätes Fenster bevorzugt, early=${early} later=${later}`);
		assert.ok(later >= 0.8, `Soft-Bedarf sollte im besseren Fenster gedeckt werden, later=${later}`);
		assert.ok(
			plan.reasonCodes.includes(REASON.THERMAL_OPPORTUNITY_DEFERRED),
			"Explainability: Plan muss die Opportunity-Entscheidung als Reason-Code ausweisen",
		);
	});

	it("wartet NICHT über thermalEmptyAtIso hinaus — Deadline vor dem besseren Fenster erzwingt frühe Nutzung", () => {
		const ctx = buildContext({
			estimatedEmptyAtIso: "2026-06-15T10:30:00.000Z", // vor dem besseren Fenster (11–15 Uhr)
			requiredEnergyKwh: 0.85,
		});
		const input = buildUnifiedInputFromForecastContext(ctx);
		const plan = allocateUnifiedDayPlan(input, { generation: 1 });
		const soft = softEnergyBySlotStart(plan);
		const early = energyInRange(soft, 8, 11);
		const afterDeadline = energyInRange(soft, 11, 15);
		assert.equal(afterDeadline, 0, "nach der Deadline darf keine Soft-Energie mehr liegen");
		assert.ok(early >= 0.8, `Bedarf muss vor der Deadline gedeckt werden, early=${early}`);
	});

	it("Hygiene (Pflicht) schlägt die Opportunity — Hard-Anteil läuft sofort trotz besserem Fenster später", () => {
		const ctx = buildContext({
			estimatedEmptyAtIso: "2026-06-15T16:00:00.000Z", // besseres Fenster (11–15 Uhr) läge noch vor der Deadline
			requiredEnergyKwh: 0, // kein Soft-Bedarf — nur Hygiene ist relevant
			hygieneDue: true,
			hygieneMandatoryKwh: 0.85,
		});
		const input = buildUnifiedInputFromForecastContext(ctx);
		const plan = allocateUnifiedDayPlan(input, { generation: 1 });
		const hard = energyBySlotStart(plan, IMMERSION_HARD_CONSUMER_ID);
		const early = [...hard].reduce((s, [iso, kwh]) => s + (new Date(iso).getUTCHours() < 11 ? kwh : 0), 0);
		const totalHard = [...hard.values()].reduce((s, v) => s + v, 0);
		assert.ok(totalHard >= 0.8, `Hygiene-Pflichtbedarf muss gedeckt werden, total=${totalHard}`);
		assert.ok(early >= 0.8, `Hygiene darf nicht auf das bessere PV-Fenster warten, early=${early}`);
	});
});
