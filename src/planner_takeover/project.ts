import { createHash } from "node:crypto";
import { sortKeysDeep } from "../planner_preparation/canonical";
import type { PlannerPlanCandidate } from "../planner_candidate/types";
import {
	canonicalizeEnergyKwh,
	canonicalizePowerW,
	canonicalizePriceCt,
	canonicalizeUtcIso,
	slotDurationMinutes,
} from "./canonize";
import type { NormalizedPlannerPlan } from "./types";

export const NORMALIZED_PLAN_SCHEMA_VERSION = 1 as const;

/**
 * Project a plan candidate onto the shared normalized comparison contract.
 * Pure — no IO, no state writes. Ignores job ids, paths, generatedAt text diagnostics.
 */
export function projectCandidateToNormalizedPlan(candidate: PlannerPlanCandidate): NormalizedPlannerPlan {
	const slots = candidate.forecastSlots.map((s) => ({
		start: canonicalizeUtcIso(s.start),
		end: canonicalizeUtcIso(s.end),
		pvPowerW: canonicalizePowerW(s.pvPowerW),
		houseLoadPowerW: canonicalizePowerW(s.houseLoadPowerW),
		fixedBalancePowerW: canonicalizePowerW(s.fixedBalancePowerW),
		gridPriceCtPerKwh: canonicalizePriceCt(s.gridPriceCtPerKwh),
		gridImportAllowed: s.gridImportAllowed,
		gridMaxImportPowerW: canonicalizePowerW(s.gridMaxImportPowerW),
	}));
	const allocations = [...candidate.allocations]
		.map((a) => ({
			contributionId: a.contributionId,
			slotStart: canonicalizeUtcIso(a.slotStart),
			slotEnd: canonicalizeUtcIso(a.slotEnd),
			powerW: canonicalizePowerW(a.powerW),
			energyKwh: canonicalizeEnergyKwh(a.energyKwh),
			status: a.status,
		}))
		.sort((x, y) => {
			const c = x.contributionId.localeCompare(y.contributionId);
			if (c !== 0) return c;
			return x.slotStart.localeCompare(y.slotStart);
		});

	const first = slots[0];
	const last = slots[slots.length - 1];
	const slotMinutes =
		first && last ? slotDurationMinutes(first.start, first.end) : 15;

	const base: Omit<NormalizedPlannerPlan, "semanticRevision"> = {
		schemaVersion: NORMALIZED_PLAN_SCHEMA_VERSION,
		horizon: {
			start: canonicalizeUtcIso(candidate.horizonStart),
			end: canonicalizeUtcIso(candidate.horizonEnd),
			slotMinutes,
		},
		slots,
		allocations,
		totals: {
			flexibleAllocatedEnergyKwh: canonicalizeEnergyKwh(candidate.totals.flexibleAllocatedEnergyKwh),
			flexibleUnallocatedEnergyKwh: canonicalizeEnergyKwh(candidate.totals.flexibleUnallocatedEnergyKwh),
			pvForecastEnergyKwh: canonicalizeEnergyKwh(candidate.totals.pvForecastEnergyKwh),
			fixedHouseLoadEnergyKwh: canonicalizeEnergyKwh(candidate.totals.fixedHouseLoadEnergyKwh),
		},
		constraintsRevision: candidate.preparationRevision,
		validationStatus: candidate.validationStatus,
		forecastStatus: candidate.forecastStatus,
		dailyStatus: candidate.dailyStatus,
		qualityCodes: [...candidate.qualityCodes].sort(),
	};

	return {
		...base,
		semanticRevision: createHash("sha256")
			.update(JSON.stringify(sortKeysDeep(base)), "utf8")
			.digest("hex"),
	};
}
