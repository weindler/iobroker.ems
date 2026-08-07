/**
 * Unified Day Plan → bestehende DailyAllocationEntry-Form für IH + Klima.
 * Keine Geräte-Writes — nur Plan-/Dispatch-Übersetzung.
 */

import { CONTRIBUTION_IDS, acUnitContributionId } from "../../contribution_ids";
import type { DailyAllocationEntry } from "../types";
import type { OperatorContributorRef } from "../../types";
import type { UnifiedAllocationCell, UnifiedDayPlan } from "./types";
import { filterRunnableAllocations, RUNNABLE_ALLOCATION_FLOOR_W } from "../addon_plan_publish";

const IH_CONTRIBUTOR: OperatorContributorRef = {
	type: "addon",
	id: "immersion_heater",
	addonId: "immersion_heater",
};

const AC_CONTRIBUTOR: OperatorContributorRef = {
	type: "addon",
	id: "air_conditioning",
	addonId: "air_conditioning",
};

function cellToEntry(cell: UnifiedAllocationCell, contributionId: string, contributor: OperatorContributorRef): DailyAllocationEntry {
	const source = cell.energySource;
	const pv = source === "pv_surplus" || source === "mixed" ? cell.allocatedPowerW : 0;
	const grid = source === "grid" || source === "mixed" ? cell.allocatedPowerW : 0;
	const bat = source === "battery" || source === "mixed" ? cell.allocatedPowerW : 0;
	return {
		contributionId,
		contributor,
		slot: cell.slot,
		status: cell.allocatedPowerW > 0 ? "allocated" : "unallocated",
		energySource: source,
		requestedPowerW: cell.allocatedPowerW,
		allocatedPowerW: cell.allocatedPowerW,
		requestedEnergyKwh: cell.allocatedEnergyKwh,
		allocatedEnergyKwh: cell.allocatedEnergyKwh,
		gridPowerW: grid,
		pvPowerW: pv,
		batteryPowerW: bat,
		mandatory: cell.constraintIds.some((id) => id.includes("mandatory") || id.includes("comfort") || id.includes("min_temp")),
		priorityRank: null,
		deadlineIso: null,
		estimatedCostCt: null,
		reasonDe: cell.reasonCodes.join(", ") || "unified_day_plan",
	};
}

/** Immersion: flexible Contribution (PV-first Soft); Pflicht separat wenn min_temp. */
export function unifiedPlanToImmersionAllocations(plan: UnifiedDayPlan): DailyAllocationEntry[] {
	const out: DailyAllocationEntry[] = [];
	for (const cell of plan.allocations) {
		if (cell.kind !== "immersion_heater") continue;
		const mandatory = cell.constraintIds.includes("thermal.min_temp") || cell.reasonCodes.includes("thermal_mandatory");
		const id = mandatory ? CONTRIBUTION_IDS.IMMERSION_MANDATORY : CONTRIBUTION_IDS.IMMERSION_FLEXIBLE;
		out.push(cellToEntry(cell, id, IH_CONTRIBUTOR));
	}
	return filterRunnableAllocations(out, RUNNABLE_ALLOCATION_FLOOR_W);
}

/** Klima: air_conditioning.unit_N */
export function unifiedPlanToClimateAllocations(plan: UnifiedDayPlan): DailyAllocationEntry[] {
	const out: DailyAllocationEntry[] = [];
	for (const cell of plan.allocations) {
		if (cell.kind !== "climate") continue;
		const m = /^air_conditioning\.unit_(\d+)$/.exec(cell.consumerId) || /^unit_(\d+)$/.exec(cell.consumerId);
		const unitIndex = m ? Number(m[1]) : Number(String(cell.consumerId).replace(/\D/g, "")) || 0;
		if (unitIndex < 1 || unitIndex > 5) continue;
		out.push(cellToEntry(cell, acUnitContributionId(unitIndex), AC_CONTRIBUTOR));
	}
	return filterRunnableAllocations(out, RUNNABLE_ALLOCATION_FLOOR_W);
}

export type UnifiedIhAcDispatchPublish = {
	immersionEntries: DailyAllocationEntry[];
	climateEntries: DailyAllocationEntry[];
	immersionStatus: "ready" | "idle";
	climateStatus: "ready" | "idle";
	immersionReasonDe: string;
	climateReasonDe: string;
};

export function buildUnifiedIhAcDispatchPublish(plan: UnifiedDayPlan): UnifiedIhAcDispatchPublish {
	const immersionEntries = unifiedPlanToImmersionAllocations(plan);
	const climateEntries = unifiedPlanToClimateAllocations(plan);
	return {
		immersionEntries,
		climateEntries,
		immersionStatus: immersionEntries.length > 0 ? "ready" : "idle",
		climateStatus: climateEntries.length > 0 ? "ready" : "idle",
		immersionReasonDe:
			immersionEntries.length > 0
				? `Unified Day Plan: ${immersionEntries.length} fahrbare Heizstab-Fenster.`
				: "Unified Day Plan: kein fahrbares Heizstab-Fenster.",
		climateReasonDe:
			climateEntries.length > 0
				? `Unified Day Plan: ${climateEntries.length} fahrbare Klima-Fenster.`
				: "Unified Day Plan: kein fahrbares Klima-Fenster.",
	};
}
