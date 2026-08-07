/**
 * Unified Plan-Authority: ersetzt klassische Add-on-Allocations in DailyPlan.
 * IH/AC/Battery/Wallbox — eine Wahrheit für allocations_json + Addon-Slices.
 * Planner schreibt keine Geräte-States.
 */

import type { DailyAllocationEntry, DailyPlan } from "../types";

export function isIhAcContributionId(contributionId: string): boolean {
	return (
		contributionId.startsWith("immersion_heater.") ||
		contributionId.startsWith("air_conditioning.")
	);
}

export function isBatteryContributionId(contributionId: string): boolean {
	return contributionId.startsWith("battery.");
}

export function isWallboxContributionId(contributionId: string): boolean {
	return contributionId.startsWith("wallbox.");
}

export function isUnifiedManagedContributionId(contributionId: string): boolean {
	return (
		isIhAcContributionId(contributionId) ||
		isBatteryContributionId(contributionId) ||
		isWallboxContributionId(contributionId)
	);
}

export type UnifiedAuthorityMeta = {
	dailyPlanRevision: number;
	unifiedPlanId: string;
};

function stampAuthority(entries: DailyAllocationEntry[], meta: UnifiedAuthorityMeta): DailyAllocationEntry[] {
	const tag = `unified_day_plan; daily_plan_rev=${meta.dailyPlanRevision}; planId=${meta.unifiedPlanId}`;
	return entries.map((e) => {
		const base = e.reasonDe?.trim() ? e.reasonDe.trim() : "unified_day_plan";
		if (base.includes("daily_plan_rev=")) return e;
		return { ...e, reasonDe: `${base}; ${tag}` };
	});
}

function sumEnergyKwh(entries: DailyAllocationEntry[]): number {
	return entries.reduce((s, e) => s + (e.allocatedEnergyKwh ?? 0), 0);
}

export type UnifiedDayAuthorityParts = {
	immersionEntries: DailyAllocationEntry[];
	climateEntries: DailyAllocationEntry[];
	/** null = klassische Battery-Einträge behalten; [] = idle. */
	batteryEntries?: DailyAllocationEntry[] | null;
	/** null = klassische Wallbox-Einträge behalten; [] = idle. */
	wallboxEntries?: DailyAllocationEntry[] | null;
};

/**
 * Ersetzt Unified-managed Contributions in plan.allocations (+ Slot-Allocations).
 */
export function applyUnifiedDayAuthority(
	plan: DailyPlan,
	parts: UnifiedDayAuthorityParts,
	meta: UnifiedAuthorityMeta,
): DailyPlan {
	const stampedIh = stampAuthority(parts.immersionEntries, meta);
	const stampedAc = stampAuthority(parts.climateEntries, meta);
	const stampedBat =
		parts.batteryEntries === null || parts.batteryEntries === undefined
			? plan.allocations.filter((a) => isBatteryContributionId(a.contributionId))
			: stampAuthority(parts.batteryEntries, meta);
	const stampedWb =
		parts.wallboxEntries === null || parts.wallboxEntries === undefined
			? plan.allocations.filter((a) => isWallboxContributionId(a.contributionId))
			: stampAuthority(parts.wallboxEntries, meta);

	const kept = plan.allocations.filter((a) => !isUnifiedManagedContributionId(a.contributionId));
	const allocations = [...kept, ...stampedIh, ...stampedAc, ...stampedBat, ...stampedWb];

	const slots = plan.slots.map((slot) => {
		const slotKept = slot.allocations.filter((a) => !isUnifiedManagedContributionId(a.contributionId));
		const start = slot.slot.startIso;
		const pick = (entries: DailyAllocationEntry[]) => entries.filter((a) => a.slot.startIso === start);
		return {
			...slot,
			allocations: [
				...slotKept,
				...pick(stampedIh),
				...pick(stampedAc),
				...pick(stampedBat),
				...pick(stampedWb),
			],
		};
	});

	return {
		...plan,
		allocations,
		slots,
		totals: {
			...plan.totals,
			immersionHeaterEnergyKwh: sumEnergyKwh(stampedIh),
			airConditioningEnergyKwh: sumEnergyKwh(stampedAc),
			batteryChargeEnergyKwh: sumEnergyKwh(
				stampedBat.filter((a) => a.contributionId === "battery.charge"),
			),
			wallboxEnergyKwh: sumEnergyKwh(stampedWb),
		},
	};
}

/**
 * IH/AC Authority (Schritt 2/3): Battery/Wallbox bleiben unverändert (null = keep).
 */
export function applyUnifiedIhAcAuthority(
	plan: DailyPlan,
	immersionEntries: DailyAllocationEntry[],
	climateEntries: DailyAllocationEntry[],
	meta: UnifiedAuthorityMeta,
): DailyPlan {
	return applyUnifiedDayAuthority(
		plan,
		{
			immersionEntries,
			climateEntries,
			batteryEntries: null,
			wallboxEntries: null,
		},
		meta,
	);
}

/** AUTH-003: IH/AC idle. */
export function clearIhAcAuthority(plan: DailyPlan): DailyPlan {
	return applyUnifiedIhAcAuthority(plan, [], [], {
		dailyPlanRevision: plan.revision,
		unifiedPlanId: "unified-failed",
	});
}

/** Battery + Wallbox + IH/AC idle — kein Classic-Fallback. */
export function clearAllUnifiedAuthority(plan: DailyPlan): DailyPlan {
	return applyUnifiedDayAuthority(
		plan,
		{
			immersionEntries: [],
			climateEntries: [],
			batteryEntries: [],
			wallboxEntries: [],
		},
		{
			dailyPlanRevision: plan.revision,
			unifiedPlanId: "unified-failed",
		},
	);
}
