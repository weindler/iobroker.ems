import type { GridRewardsSource } from "./types";

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

export interface ResolvedGridRewards {
	creditEur: number | null;
	source: GridRewardsSource;
}

/** Netto-Heim-Netz € nach Rewards-Gutschrift (nur Anzeige; max. Brutto-Netz). */
export function netHomeGridCostEur(
	homeGridCostEur: number | null,
	rewardsCreditEur: number | null,
): number | null {
	if (homeGridCostEur === null) return null;
	if (rewardsCreditEur === null || !(rewardsCreditEur > 0)) return homeGridCostEur;
	return round2(Math.max(0, homeGridCostEur - Math.min(rewardsCreditEur, homeGridCostEur)));
}

export function resolveTodayGridRewards(input: {
	enabled: boolean;
	mappedDayEur: number | null;
}): ResolvedGridRewards {
	if (!input.enabled) {
		return { creditEur: null, source: "off" };
	}
	if (input.mappedDayEur !== null && input.mappedDayEur >= 0) {
		return { creditEur: round2(input.mappedDayEur), source: "estimate_day" };
	}
	return { creditEur: null, source: "off" };
}

export function resolveMonthGridRewards(input: {
	enabled: boolean;
	monthPrefix: string;
	billingCreditEur: number | null;
	mappedMonthEur: number | null;
}): ResolvedGridRewards {
	if (!input.enabled) {
		return { creditEur: null, source: "off" };
	}
	if (input.billingCreditEur !== null && input.billingCreditEur >= 0) {
		return { creditEur: round2(input.billingCreditEur), source: "billing" };
	}
	if (input.mappedMonthEur !== null && input.mappedMonthEur >= 0) {
		return { creditEur: round2(input.mappedMonthEur), source: "estimate_month" };
	}
	return { creditEur: null, source: "off" };
}

export function gridRewardsLabelDe(source: GridRewardsSource): string {
	switch (source) {
		case "estimate_day":
		case "estimate_month":
			return "Grid Rewards Schätzung";
		case "billing":
			return "Abrechnung";
		default:
			return "";
	}
}
