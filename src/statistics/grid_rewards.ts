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

/** Rewards über eine Periode: Abrechnung je Monat, sonst Schätzung (nur laufender Monat) bzw. Tages-Persist. */
export function resolvePeriodGridRewards(input: {
	enabled: boolean;
	fromKey: string;
	toKey: string;
	todayKey: string;
	mappedMonthEur: number | null;
	monthRewardsBilling: Record<string, { creditEur: number } | undefined>;
	dayCredits: Array<{ dateKey: string; creditEur: number | null }>;
}): ResolvedGridRewards {
	if (!input.enabled) return { creditEur: null, source: "off" };

	const prefixes = new Set<string>();
	for (const d of input.dayCredits) {
		if (d.dateKey >= input.fromKey && d.dateKey <= input.toKey) {
			prefixes.add(d.dateKey.slice(0, 7));
		}
	}
	// auch Monate ohne Persist-Tage (nur Billing)
	const fromY = Number(input.fromKey.slice(0, 4));
	const fromM = Number(input.fromKey.slice(5, 7));
	const toY = Number(input.toKey.slice(0, 4));
	const toM = Number(input.toKey.slice(5, 7));
	let y = fromY;
	let m = fromM;
	while (y < toY || (y === toY && m <= toM)) {
		prefixes.add(`${y}-${String(m).padStart(2, "0")}`);
		m += 1;
		if (m > 12) {
			m = 1;
			y += 1;
		}
	}

	let total = 0;
	let hits = 0;
	let anyBilling = false;
	let anyEstimate = false;
	const currentPrefix = input.todayKey.slice(0, 7);

	for (const prefix of [...prefixes].sort()) {
		const billing = input.monthRewardsBilling[prefix];
		if (billing && billing.creditEur >= 0) {
			total += billing.creditEur;
			hits++;
			anyBilling = true;
			continue;
		}
		if (prefix === currentPrefix && input.mappedMonthEur !== null && input.mappedMonthEur >= 0) {
			total += input.mappedMonthEur;
			hits++;
			anyEstimate = true;
			continue;
		}
		const daySum = input.dayCredits
			.filter((d) => d.dateKey.startsWith(prefix) && d.dateKey >= input.fromKey && d.dateKey <= input.toKey)
			.reduce((a, d) => a + (d.creditEur ?? 0), 0);
		if (daySum > 0) {
			total += daySum;
			hits++;
			anyEstimate = true;
		}
	}

	if (!hits) return { creditEur: null, source: "off" };
	const src: ResolvedGridRewards["source"] =
		anyBilling && !anyEstimate ? "billing" : "estimate_month";
	return { creditEur: round2(total), source: src };
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
