import type { HomeDayTotals, MobilityDayTotals } from "./types";

function round3(n: number): number {
	return Math.round(n * 1000) / 1000;
}

function round2(n: number): number {
	return Math.round(n * 100) / 100;
}

/** Festtarif-Kosten für denselben Netzbezug (Verivox-Vergleich). */
export function fixedTariffCostEur(input: {
	gridImportKwh: number | null;
	compareTariffCtPerKwh: number | null;
	monthlyBaseEur: number | null;
	/** Anteil des Monats (1 = voller Monat); für „heute“ typisch 1/TageImMonat. */
	monthFraction: number;
}): number | null {
	if (input.gridImportKwh === null || input.compareTariffCtPerKwh === null) {
		return null;
	}
	if (!(input.gridImportKwh >= 0) || !(input.compareTariffCtPerKwh >= 0)) {
		return null;
	}
	const energyEur = (input.gridImportKwh * input.compareTariffCtPerKwh) / 100;
	const base =
		input.monthlyBaseEur !== null && input.monthlyBaseEur > 0 && input.monthFraction > 0
			? input.monthlyBaseEur * input.monthFraction
			: 0;
	return round2(energyEur + base);
}

export function savingsVsFixedEur(
	fixedTariffCostEurVal: number | null,
	dynamicCostEur: number | null,
	rewardsCreditEur: number | null,
): number | null {
	if (fixedTariffCostEurVal === null || dynamicCostEur === null) {
		return null;
	}
	const netDynamic = dynamicCostEur - (rewardsCreditEur ?? 0);
	return round2(fixedTariffCostEurVal - netDynamic);
}

/** Energie-Delta aus Zählerständen; Reset (neuer Tag / kleiner) → null (kein negativer Sprung). */
export function energyCounterDeltaKwh(
	previous: number | null,
	current: number | null,
): { deltaKwh: number | null; newBaseline: number | null } {
	if (current === null) {
		return { deltaKwh: null, newBaseline: previous };
	}
	if (previous === null) {
		return { deltaKwh: 0, newBaseline: current };
	}
	if (current + 0.05 < previous) {
		// Zähler-Reset / Tageszähler-Neustart
		return { deltaKwh: 0, newBaseline: current };
	}
	return { deltaKwh: round3(current - previous), newBaseline: current };
}

/** Leistung × Preis über dt → Kostenanteil. priceCtPerKwh, powerW Import. */
export function integrateImportCostEur(input: {
	importPowerW: number | null;
	priceCtPerKwh: number | null;
	dtSec: number;
}): { costEur: number; kwh: number } {
	if (
		input.importPowerW === null ||
		input.priceCtPerKwh === null ||
		!(input.dtSec > 0) ||
		!(input.importPowerW > 0) ||
		!(input.priceCtPerKwh >= 0)
	) {
		return { costEur: 0, kwh: 0 };
	}
	const kwh = (input.importPowerW / 1000) * (input.dtSec / 3600);
	const costEur = (kwh * input.priceCtPerKwh) / 100;
	return { costEur: round3(costEur), kwh: round3(kwh) };
}

export function daysInMonth(dateKey: string): number {
	const m = /^(\d{4})-(\d{2})-/.exec(dateKey);
	if (!m) return 30;
	const y = Number(m[1]);
	const mo = Number(m[2]);
	return new Date(y, mo, 0).getDate();
}

export function localDateKey(d: Date, timeZone = "Europe/Berlin"): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(d);
}

export function resolveEvKwhPer100(input: {
	mapped: number | null;
	fallback: number | null;
}): { value: number | null; source: "ford_hass" | "admin_fallback" | "missing" } {
	if (input.mapped !== null && input.mapped > 0) {
		return { value: input.mapped, source: "ford_hass" };
	}
	if (input.fallback !== null && input.fallback > 0) {
		return { value: input.fallback, source: "admin_fallback" };
	}
	return { value: null, source: "missing" };
}

export function resolveFuelPriceEurPerL(input: {
	mapped: number | null;
	fallback: number | null;
}): number | null {
	if (input.mapped !== null && input.mapped > 0) return input.mapped;
	if (input.fallback !== null && input.fallback > 0) return input.fallback;
	return null;
}

/** km aus geladener Batterie-Energie (AC→Batterie grob ohne Effizienz-Erfindung: gelieferte kWh). */
export function estimateKmFromEvKwh(kwh: number | null, kwhPer100: number | null): number | null {
	if (kwh === null || kwhPer100 === null || !(kwhPer100 > 0) || !(kwh >= 0)) return null;
	return round1(kwh * (100 / kwhPer100));
}

function round1(n: number): number {
	return Math.round(n * 10) / 10;
}

export function iceCostForKm(input: {
	km: number | null;
	lPer100Km: number | null;
	fuelPriceEurPerL: number | null;
}): { liters: number | null; costEur: number | null } {
	if (
		input.km === null ||
		input.lPer100Km === null ||
		input.fuelPriceEurPerL === null ||
		!(input.km >= 0) ||
		!(input.lPer100Km > 0) ||
		!(input.fuelPriceEurPerL > 0)
	) {
		return { liters: null, costEur: null };
	}
	const liters = round3((input.km / 100) * input.lPer100Km);
	return { liters, costEur: round2(liters * input.fuelPriceEurPerL) };
}

/** SOC-Anstieg ohne Wallbox → geschätzte Batterie-kWh (nur Trigger, nicht Abrechnung). */
export function estimateKwhFromSocRise(input: {
	socBeforePct: number | null;
	socAfterPct: number | null;
	capacityKwh: number | null;
	minRisePct: number;
}): number | null {
	if (
		input.socBeforePct === null ||
		input.socAfterPct === null ||
		input.capacityKwh === null ||
		!(input.capacityKwh > 0)
	) {
		return null;
	}
	const rise = input.socAfterPct - input.socBeforePct;
	if (rise < input.minRisePct) return null;
	return round3((rise / 100) * input.capacityKwh);
}

export function emptyHomeDay(dateKey: string): HomeDayTotals {
	return {
		dateKey,
		gridImportKwh: null,
		gridExportKwh: null,
		dynamicCostEur: null,
		fixedTariffCostEur: null,
		savingsVsFixedEur: null,
		gridRewardsCreditEur: null,
		feedInCreditEur: null,
	};
}

export function emptyMobilityDay(dateKey: string): MobilityDayTotals {
	return {
		dateKey,
		homePvKwh: null,
		homeGridKwh: null,
		homePvCostEur: null,
		homeGridCostEur: null,
		gridRewardsCreditEur: null,
		publicInvoicedKwh: null,
		publicInvoicedEur: null,
		publicPendingKwh: null,
		evTotalCostEur: null,
		evKwhPer100Km: null,
		evKwhPer100KmSource: null,
		estimatedKm: null,
		iceLiters: null,
		iceFuelPriceEurPerL: null,
		iceCostEur: null,
		savingsVsIceEur: null,
	};
}

export function sumHomeDays(days: HomeDayTotals[]): HomeDayTotals {
	const dateKey = days[0]?.dateKey ?? "";
	const sum = (pick: (d: HomeDayTotals) => number | null): number | null => {
		const vals = days.map(pick).filter((v): v is number => v !== null);
		if (!vals.length) return null;
		return round3(vals.reduce((a, b) => a + b, 0));
	};
	const importKwh = sum((d) => d.gridImportKwh);
	const dynamic = sum((d) => d.dynamicCostEur);
	const fixed = sum((d) => d.fixedTariffCostEur);
	const rewards = sum((d) => d.gridRewardsCreditEur);
	return {
		dateKey,
		gridImportKwh: importKwh,
		gridExportKwh: sum((d) => d.gridExportKwh),
		dynamicCostEur: dynamic,
		fixedTariffCostEur: fixed,
		savingsVsFixedEur: savingsVsFixedEur(fixed, dynamic, rewards),
		gridRewardsCreditEur: rewards,
		feedInCreditEur: sum((d) => d.feedInCreditEur),
	};
}

export function sumMobilityDays(days: MobilityDayTotals[]): MobilityDayTotals {
	const dateKey = days[0]?.dateKey ?? "";
	const sum = (pick: (d: MobilityDayTotals) => number | null): number | null => {
		const vals = days.map(pick).filter((v): v is number => v !== null);
		if (!vals.length) return null;
		return round3(vals.reduce((a, b) => a + b, 0));
	};
	const evCost = sum((d) => d.evTotalCostEur);
	const iceCost = sum((d) => d.iceCostEur);
	const lastWithSrc = [...days].reverse().find((d) => d.evKwhPer100KmSource);
	return {
		dateKey,
		homePvKwh: sum((d) => d.homePvKwh),
		homeGridKwh: sum((d) => d.homeGridKwh),
		homePvCostEur: sum((d) => d.homePvCostEur),
		homeGridCostEur: sum((d) => d.homeGridCostEur),
		gridRewardsCreditEur: sum((d) => d.gridRewardsCreditEur),
		publicInvoicedKwh: sum((d) => d.publicInvoicedKwh),
		publicInvoicedEur: sum((d) => d.publicInvoicedEur),
		publicPendingKwh: sum((d) => d.publicPendingKwh),
		evTotalCostEur: evCost,
		evKwhPer100Km: lastWithSrc?.evKwhPer100Km ?? null,
		evKwhPer100KmSource: lastWithSrc?.evKwhPer100KmSource ?? null,
		estimatedKm: sum((d) => d.estimatedKm),
		iceLiters: sum((d) => d.iceLiters),
		iceFuelPriceEurPerL: lastWithSrc?.iceFuelPriceEurPerL ?? null,
		iceCostEur: iceCost,
		savingsVsIceEur:
			evCost !== null && iceCost !== null ? round2(iceCost - evCost) : null,
	};
}
