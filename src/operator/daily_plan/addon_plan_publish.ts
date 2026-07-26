import type { DailyAllocationEntry, DailyPlan } from "./types";

/** Unter dieser Leistung gilt ein Allocation-Eintrag als nicht fahrbar (VIS/Status). */
export const RUNNABLE_ALLOCATION_FLOOR_W = 50;

export function addonAllocationEntries(plan: DailyPlan, addonPrefix: string): DailyAllocationEntry[] {
	if (addonPrefix === "air_conditioning") {
		return plan.allocations.filter((a) => a.contributionId.startsWith("air_conditioning."));
	}
	return plan.allocations.filter(
		(a) =>
			a.contributionId === addonPrefix ||
			a.contributionId.startsWith(`${addonPrefix}.`) ||
			(a.contributor.id === addonPrefix && addonPrefix !== "air_conditioning"),
	);
}

export function filterRunnableAllocations(
	entries: DailyAllocationEntry[],
	floorW: number = RUNNABLE_ALLOCATION_FLOOR_W,
): DailyAllocationEntry[] {
	return entries.filter((a) => (a.allocatedPowerW ?? 0) >= floorW);
}

export function addonAllocationPublishView(
	plan: DailyPlan,
	addonPrefix: string,
	opts?: { kiWriteback?: boolean; floorW?: number },
): { runnable: DailyAllocationEntry[]; status: "ready" | "idle"; reasonDe: string } {
	const all = addonAllocationEntries(plan, addonPrefix);
	const runnable = filterRunnableAllocations(all, opts?.floorW);
	const ki = opts?.kiWriteback ? " (ggf. KI Plan B)" : "";
	if (runnable.length > 0) {
		return {
			runnable,
			status: "ready",
			reasonDe: `${runnable.length} fahrbare Fenster für ${addonPrefix}${ki}.`,
		};
	}
	if (all.length > 0) {
		return {
			runnable,
			status: "idle",
			reasonDe: `Keine fahrbaren Fenster für ${addonPrefix} (${all.length} Mikro-Einträge verworfen)${ki}.`,
		};
	}
	return {
		runnable,
		status: "idle",
		reasonDe: `Keine Allocation für ${addonPrefix}.`,
	};
}
