import { createHash } from "node:crypto";
import { sortKeysDeep } from "../planner_preparation/canonical";
import type { DailyPlan } from "../operator/daily_plan/types";
import type { ForecastPlan } from "../operator/forecast/types";
import type { PlanContribution } from "../operator/types";

export const PLANNER_CANDIDATE_SCHEMA_VERSION = 1 as const;
export const PLANNER_CANDIDATE_FILE = "plan_candidate_v1.json";
export const PLANNER_CANDIDATE_BUDGET_BYTES = 512 * 1024;

export interface PlannerPlanCandidate {
	schemaVersion: typeof PLANNER_CANDIDATE_SCHEMA_VERSION;
	inputRevision: string;
	preparationRevision: string;
	candidateRevision: string;
	generatedAt: string;
	capturedAt: string;
	timezone: string;
	horizonStart: string;
	horizonEnd: string;
	slotCount: number;
	forecastStatus: string;
	dailyStatus: string;
	validationStatus: "ok" | "degraded" | "failed";
	qualityCodes: string[];
	contributions: Array<{
		contributionId: string;
		enabled: boolean;
		flexible: boolean;
		gridEligible: boolean;
		qualityStatus: string;
	}>;
	forecastSlots: Array<{
		start: string;
		end: string;
		pvPowerW: number | null;
		houseLoadPowerW: number | null;
		fixedBalancePowerW: number | null;
		gridPriceCtPerKwh: number | null;
		gridImportAllowed: boolean | null;
		gridMaxImportPowerW: number | null;
	}>;
	allocations: Array<{
		contributionId: string;
		slotStart: string;
		slotEnd: string;
		powerW: number | null;
		energyKwh: number | null;
		status: string;
	}>;
	totals: {
		flexibleAllocatedEnergyKwh: number | null;
		flexibleUnallocatedEnergyKwh: number | null;
		pvForecastEnergyKwh: number | null;
		fixedHouseLoadEnergyKwh: number | null;
	};
}

export function computeCandidateRevision(
	candidate: Omit<PlannerPlanCandidate, "candidateRevision" | "generatedAt">,
): string {
	return createHash("sha256").update(JSON.stringify(sortKeysDeep(candidate)), "utf8").digest("hex");
}

export function buildPlanCandidateFromPlans(input: {
	inputRevision: string;
	preparationRevision: string;
	capturedAt: string;
	timezone: string;
	horizonStart: string;
	horizonEnd: string;
	forecast: ForecastPlan;
	daily: DailyPlan;
	contributions: PlanContribution[];
}): PlannerPlanCandidate {
	const forecastSlots = input.forecast.slots.map((s) => ({
		start: s.slot.startIso,
		end: s.slot.endIso,
		pvPowerW: s.pvPowerW,
		houseLoadPowerW: s.houseLoadPowerW,
		fixedBalancePowerW: s.fixedBalancePowerW,
		gridPriceCtPerKwh: s.gridPriceCtPerKwh,
		gridImportAllowed: s.gridImportAllowed,
		gridMaxImportPowerW: s.gridMaxImportPowerW,
	}));
	const allocations = input.daily.allocations.map((a) => ({
		contributionId: a.contributionId,
		slotStart: a.slot.startIso,
		slotEnd: a.slot.endIso,
		powerW: a.allocatedPowerW,
		energyKwh: a.allocatedEnergyKwh,
		status: a.status,
	}));
	const contributions = input.contributions.map((c) => ({
		contributionId: c.contributionId,
		enabled: c.enabled,
		flexible: c.flexible,
		gridEligible: c.gridEligible,
		qualityStatus: c.quality.status,
	}));
	const qualityCodes: string[] = [];
	if (input.forecast.status !== "ready") qualityCodes.push(`forecast_${input.forecast.status}`);
	if (input.daily.status !== "ready") qualityCodes.push(`daily_${input.daily.status}`);
	const validationStatus: PlannerPlanCandidate["validationStatus"] =
		input.forecast.status === "missing_inputs" || input.daily.status === "missing_inputs"
			? "failed"
			: input.forecast.status === "degraded" || input.daily.status === "degraded"
				? "degraded"
				: "ok";
	const base = {
		schemaVersion: PLANNER_CANDIDATE_SCHEMA_VERSION,
		inputRevision: input.inputRevision,
		preparationRevision: input.preparationRevision,
		capturedAt: input.capturedAt,
		timezone: input.timezone,
		horizonStart: input.horizonStart,
		horizonEnd: input.horizonEnd,
		slotCount: forecastSlots.length,
		forecastStatus: String(input.forecast.status),
		dailyStatus: String(input.daily.status),
		validationStatus,
		qualityCodes,
		contributions,
		forecastSlots,
		allocations,
		totals: {
			flexibleAllocatedEnergyKwh: input.daily.totals.flexibleAllocatedEnergyKwh,
			flexibleUnallocatedEnergyKwh: input.daily.totals.flexibleUnallocatedEnergyKwh,
			pvForecastEnergyKwh: input.daily.totals.pvForecastEnergyKwh,
			fixedHouseLoadEnergyKwh: input.daily.totals.fixedHouseLoadEnergyKwh,
		},
	};
	return {
		...base,
		candidateRevision: computeCandidateRevision(base),
		generatedAt: input.capturedAt,
	};
}
