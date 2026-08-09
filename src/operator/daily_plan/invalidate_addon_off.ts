/**
 * Befund 005: Beim Wechsel auf Add-on mode=off sofort aktive Plan-Darstellung
 * invalidieren — kein Warten auf den nächsten Daily-Plan-Tick.
 */

import type { DailyAllocationEntry, DailyPlan } from "./types";
import type { UnifiedAllocationCell, UnifiedDayPlan } from "./unified/types";
import type { ExecutionModeAddonId } from "../../execution_mode";
import { isBatteryContributionId, isWallboxContributionId } from "./unified/authority";

export function isAddonContributionId(addonId: ExecutionModeAddonId, contributionId: string): boolean {
	switch (addonId) {
		case "immersion_heater":
			return contributionId.startsWith("immersion_heater.");
		case "air_conditioning":
			return contributionId.startsWith("air_conditioning.");
		case "battery":
			return isBatteryContributionId(contributionId);
		case "wallbox":
			return isWallboxContributionId(contributionId);
		default:
			return false;
	}
}

export function unifiedKindsForAddon(addonId: ExecutionModeAddonId): ReadonlySet<UnifiedAllocationCell["kind"]> {
	switch (addonId) {
		case "immersion_heater":
			return new Set(["immersion_heater"]);
		case "air_conditioning":
			return new Set(["climate"]);
		case "battery":
			return new Set(["battery_charge", "battery_discharge"]);
		case "wallbox":
			return new Set(["wallbox"]);
		default:
			return new Set();
	}
}

/** Entfernt aktive EMS-Fenster des Add-ons aus dem Unified-Plan (in-memory). */
export function stripAddonFromUnifiedPlan(plan: UnifiedDayPlan, addonId: ExecutionModeAddonId): UnifiedDayPlan {
	const kinds = unifiedKindsForAddon(addonId);
	const allocations = plan.allocations.filter((a) => !kinds.has(a.kind));
	return { ...plan, allocations };
}

/** Entfernt Addon-Slices aus dem publizierten Daily Plan. */
export function stripAddonFromDailyPlan(plan: DailyPlan, addonId: ExecutionModeAddonId): DailyPlan {
	const keep = (a: DailyAllocationEntry) => !isAddonContributionId(addonId, a.contributionId);
	const allocations = plan.allocations.filter(keep);
	const slots = plan.slots.map((slot) => ({
		...slot,
		allocations: slot.allocations.filter(keep),
	}));
	return { ...plan, allocations, slots };
}
