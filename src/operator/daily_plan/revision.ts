import { createHash } from "node:crypto";
import type { DailyPlan, DailyPlanSlot } from "./types";

function slotForRevision(slot: DailyPlanSlot, index: number): Record<string, unknown> {
	return {
		index,
		pvForecastPowerW: slot.pvForecastPowerW,
		fixedHouseLoadPowerW: slot.fixedHouseLoadPowerW,
		fixedBalancePowerW: slot.fixedBalancePowerW,
		gridPriceCtPerKwh: slot.gridPriceCtPerKwh,
		gridImportAllowed: slot.gridImportAllowed,
		allocatedFlexiblePowerW: slot.allocatedFlexiblePowerW,
		allocatedPvPowerW: slot.allocatedPvPowerW,
		allocatedGridPowerW: slot.allocatedGridPowerW,
		allocations: slot.allocations.map((a) => ({
			contributionId: a.contributionId,
			status: a.status,
			energySource: a.energySource,
			allocatedPowerW: a.allocatedPowerW,
			allocatedEnergyKwh: a.allocatedEnergyKwh,
			gridPowerW: a.gridPowerW,
			pvPowerW: a.pvPowerW,
			mandatory: a.mandatory,
			estimatedCostCt: a.estimatedCostCt,
		})),
	};
}

/** Semantic revision payload — allocation core only, no volatile metadata. */
export function dailyPlanRevisionPayload(plan: DailyPlan): string {
	return JSON.stringify({
		date: plan.date,
		timezone: plan.timezone,
		globalMode: plan.globalMode,
		status: plan.status,
		activeContributionIds: plan.activeContributionIds,
		excludedContributions: plan.excludedContributions.map((e) => ({
			contributionId: e.contributionId,
		})),
		slots: plan.slots.map((slot, index) => slotForRevision(slot, index)),
		unallocated: plan.unallocated.map((u) => ({
			contributionId: u.contributionId,
			requestedEnergyKwh: u.requestedEnergyKwh,
			allocatedEnergyKwh: u.allocatedEnergyKwh,
			unallocatedEnergyKwh: u.unallocatedEnergyKwh,
		})),
		totals: plan.totals,
	});
}

export function dailyPlanSemanticRevisionHash(plan: DailyPlan): string {
	return createHash("sha256").update(dailyPlanRevisionPayload(plan)).digest("hex");
}

export function parseDailyPlanFromJson(raw: string | null): DailyPlan | null {
	if (!raw || !raw.trim()) return null;
	try {
		const parsed = JSON.parse(raw) as DailyPlan;
		if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.slots)) return null;
		return parsed;
	} catch {
		return null;
	}
}
