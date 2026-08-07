/**
 * IH/AC Plan-Authority: Unified ersetzt klassische Heizstab-/Klima-Allocations
 * in der bestehenden DailyPlan-Struktur. Battery/Wallbox bleiben klassisch.
 */

import type { DailyAllocationEntry, DailyPlan } from "../types";

export function isIhAcContributionId(contributionId: string): boolean {
	return (
		contributionId.startsWith("immersion_heater.") ||
		contributionId.startsWith("air_conditioning.")
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

/**
 * Ersetzt IH/AC in plan.allocations (+ Slot-Allocations) durch Unified-Entries.
 * Battery/Wallbox und sonstige Contributions bleiben unverändert.
 */
export function applyUnifiedIhAcAuthority(
	plan: DailyPlan,
	immersionEntries: DailyAllocationEntry[],
	climateEntries: DailyAllocationEntry[],
	meta: UnifiedAuthorityMeta,
): DailyPlan {
	const stampedIh = stampAuthority(immersionEntries, meta);
	const stampedAc = stampAuthority(climateEntries, meta);
	const kept = plan.allocations.filter((a) => !isIhAcContributionId(a.contributionId));
	const allocations = [...kept, ...stampedIh, ...stampedAc];

	const slots = plan.slots.map((slot) => {
		const slotKept = slot.allocations.filter((a) => !isIhAcContributionId(a.contributionId));
		const start = slot.slot.startIso;
		const slotIh = stampedIh.filter((a) => a.slot.startIso === start);
		const slotAc = stampedAc.filter((a) => a.slot.startIso === start);
		return {
			...slot,
			allocations: [...slotKept, ...slotIh, ...slotAc],
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
		},
	};
}

/** AUTH-003: IH/AC aus dem Plan entfernen (bewusst idle, kein klassischer Fallback). */
export function clearIhAcAuthority(plan: DailyPlan): DailyPlan {
	return applyUnifiedIhAcAuthority(plan, [], [], {
		dailyPlanRevision: plan.revision,
		unifiedPlanId: "unified-failed",
	});
}
