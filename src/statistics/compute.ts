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

/** Tagesanteil einer Monatsgebühr (€). */
export function dailyBaseShareEur(monthlyEur: number | null, monthFraction: number): number {
	if (monthlyEur === null || !(monthlyEur > 0) || !(monthFraction > 0)) return 0;
	return round2(monthlyEur * monthFraction);
}

/** Tibber-Tageskosten: Live-Wert + anteilige Monatsgebühren (Grundpreis + Netzentgelt). */
export function tibberDayCostEur(input: {
	accumulatedCostEur: number | null;
	monthlyBaseEur: number | null;
	monthlyGridFeeEur: number | null;
	monthFraction: number;
}): number | null {
	if (input.accumulatedCostEur === null || !(input.accumulatedCostEur >= 0)) {
		return null;
	}
	const fees =
		dailyBaseShareEur(input.monthlyBaseEur, input.monthFraction) +
		dailyBaseShareEur(input.monthlyGridFeeEur, input.monthFraction);
	return round2(input.accumulatedCostEur + fees);
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

/**
 * EVCC status.sessionEnergy = Wh; EMS addons.wallbox.evcc.session_energy_kwh = kWh.
 * Statistik muss Wh→kWh, wenn direkt auf EVCC gemappt wird.
 */
export function normalizeWallboxSessionEnergyKwh(
	stateId: string,
	raw: number | null,
): number | null {
	if (raw === null || !Number.isFinite(raw)) return null;
	const id = stateId.trim();
	if (!id) return round3(raw);
	if (/session_energy_kwh/i.test(id)) {
		return round3(raw);
	}
	if (/sessionenergy/i.test(id)) {
		return round3(raw / 1000);
	}
	return round3(raw);
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

/** Beim manuellen Seed: expliziter Tag-Preis, sonst Admin-Fallback — nicht Live-Tankerkönig. */
export function resolveSeedFuelPriceEurPerL(input: {
	explicit: number | null | undefined;
	fallback: number | null;
}): number | null {
	if (input.explicit !== null && input.explicit !== undefined && input.explicit > 0) {
		return input.explicit;
	}
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

export function sumMobilityDays(
	days: MobilityDayTotals[],
	monthFinalize?: {
		evKwhPer100: number | null;
		fuelPriceEurPerL: number | null;
		iceLPer100Km: number | null;
		evKwhPer100KmSource: MobilityDayTotals["evKwhPer100KmSource"];
	},
): MobilityDayTotals {
	const dateKey = days[0]?.dateKey ?? "";
	const sum = (pick: (d: MobilityDayTotals) => number | null): number | null => {
		const vals = days.map(pick).filter((v): v is number => v !== null);
		if (!vals.length) return null;
		return round3(vals.reduce((a, b) => a + b, 0));
	};
	const homePvKwh = sum((d) => d.homePvKwh);
	const homeGridKwh = sum((d) => d.homeGridKwh);
	const homePvCostEur = sum((d) => d.homePvCostEur);
	const homeGridCostEur = sum((d) => d.homeGridCostEur);
	const publicInvoicedKwh = sum((d) => d.publicInvoicedKwh);
	const publicInvoicedEur = sum((d) => d.publicInvoicedEur);
	const lastWithSrc = [...days].reverse().find((d) => d.evKwhPer100KmSource);

	const evCostParts = days
		.map((d) => mobilityDayEvCostEur(d))
		.filter((v): v is number => v !== null);
	let evCost = evCostParts.length
		? round2(evCostParts.reduce((a, b) => a + b, 0))
		: null;
	if (evCost === null) {
		const parts = [homePvCostEur, homeGridCostEur, publicInvoicedEur].filter(
			(v): v is number => v !== null,
		);
		if (parts.length > 0) {
			evCost = round2(parts.reduce((a, b) => a + b, 0));
		}
	}

	const totalChargeKwh =
		(homePvKwh ?? 0) + (homeGridKwh ?? 0) + (publicInvoicedKwh ?? 0);
	const evKwhPer100 =
		monthFinalize?.evKwhPer100 ?? lastWithSrc?.evKwhPer100Km ?? null;
	const fuelPrice =
		monthFinalize?.fuelPriceEurPerL ?? lastWithSrc?.iceFuelPriceEurPerL ?? null;

	let estimatedKm: number | null = null;
	const kmParts = days
		.map((d) => mobilityDayEstimatedKm(d, evKwhPer100))
		.filter((v): v is number => v !== null);
	if (kmParts.length > 0) {
		estimatedKm = round3(kmParts.reduce((a, b) => a + b, 0));
	} else if (totalChargeKwh > 0 && evKwhPer100) {
		estimatedKm = estimateKmFromEvKwh(totalChargeKwh, evKwhPer100);
	}

	let iceCost = sum((d) => d.iceCostEur);
	let iceLiters = sum((d) => d.iceLiters);
	const iceLPer100 = monthFinalize?.iceLPer100Km ?? null;
	if (iceLPer100 !== null) {
		const iceParts = days.map((d) => mobilityDayIceCost(d, evKwhPer100, iceLPer100, fuelPrice));
		const valid = iceParts.filter((p) => p.costEur !== null);
		if (valid.length > 0) {
			iceCost = round2(valid.reduce((a, b) => a + (b.costEur ?? 0), 0));
			iceLiters = round3(valid.reduce((a, b) => a + (b.liters ?? 0), 0));
		}
	}

	return {
		dateKey,
		homePvKwh,
		homeGridKwh,
		homePvCostEur,
		homeGridCostEur,
		gridRewardsCreditEur: sum((d) => d.gridRewardsCreditEur),
		publicInvoicedKwh,
		publicInvoicedEur,
		publicPendingKwh: sum((d) => d.publicPendingKwh),
		evTotalCostEur: evCost,
		evKwhPer100Km: evKwhPer100,
		evKwhPer100KmSource:
			monthFinalize?.evKwhPer100KmSource ?? lastWithSrc?.evKwhPer100KmSource ?? null,
		estimatedKm,
		iceLiters,
		iceFuelPriceEurPerL: fuelPrice,
		iceCostEur: iceCost,
		savingsVsIceEur:
			evCost !== null && iceCost !== null ? round2(iceCost - evCost) : null,
	};
}

function mobilityDayChargeKwh(d: MobilityDayTotals): number {
	return (d.homePvKwh ?? 0) + (d.homeGridKwh ?? 0) + (d.publicInvoicedKwh ?? 0);
}

function mobilityDayEvCostEur(d: MobilityDayTotals): number | null {
	if (d.evTotalCostEur !== null) return d.evTotalCostEur;
	const parts = [d.homePvCostEur, d.homeGridCostEur, d.publicInvoicedEur].filter(
		(v): v is number => v !== null,
	);
	if (!parts.length) return null;
	const raw =
		parts.reduce((a, b) => a + b, 0) - (d.gridRewardsCreditEur ?? 0);
	if (mobilityDayChargeKwh(d) <= 0 && (d.publicInvoicedEur ?? 0) <= 0) return null;
	return round2(Math.max(0, raw));
}

function mobilityDayEstimatedKm(
	d: MobilityDayTotals,
	evKwhPer100: number | null,
): number | null {
	if (d.estimatedKm !== null) return d.estimatedKm;
	const charge = mobilityDayChargeKwh(d);
	return estimateKmFromEvKwh(charge > 0 ? charge : null, evKwhPer100);
}

function mobilityDayIceCost(
	d: MobilityDayTotals,
	evKwhPer100: number | null,
	iceLPer100Km: number,
	defaultFuelPriceEurPerL: number | null,
): { liters: number | null; costEur: number | null } {
	if (d.iceCostEur !== null) {
		return { liters: d.iceLiters, costEur: d.iceCostEur };
	}
	const km = mobilityDayEstimatedKm(d, evKwhPer100);
	const fuelPrice = d.iceFuelPriceEurPerL ?? defaultFuelPriceEurPerL;
	return iceCostForKm({
		km,
		lPer100Km: iceLPer100Km,
		fuelPriceEurPerL: fuelPrice,
	});
}

/** Nach manuellem Seed: €/km/Verbrenner aus kWh+Kosten ableiten. */
export function finalizeMobilityDayTotals(
	mob: MobilityDayTotals,
	input: {
		evKwhPer100: number | null;
		fuelPriceEurPerL: number | null;
		iceLPer100Km: number | null;
		evKwhPer100KmSource?: MobilityDayTotals["evKwhPer100KmSource"];
	},
): void {
	const totalChargeKwh =
		(mob.homePvKwh ?? 0) + (mob.homeGridKwh ?? 0) + (mob.publicInvoicedKwh ?? 0);
	const evCostRaw =
		(mob.homePvCostEur ?? 0) +
		(mob.homeGridCostEur ?? 0) +
		(mob.publicInvoicedEur ?? 0) -
		(mob.gridRewardsCreditEur ?? 0);
	if (totalChargeKwh > 0 || (mob.publicInvoicedEur ?? 0) > 0) {
		mob.evTotalCostEur = round2(Math.max(0, evCostRaw));
	} else {
		mob.evTotalCostEur = null;
	}
	mob.evKwhPer100Km = input.evKwhPer100;
	mob.evKwhPer100KmSource = input.evKwhPer100KmSource ?? null;
	mob.estimatedKm = estimateKmFromEvKwh(
		totalChargeKwh > 0 ? totalChargeKwh : null,
		input.evKwhPer100,
	);
	const ice = iceCostForKm({
		km: mob.estimatedKm,
		lPer100Km: input.iceLPer100Km,
		fuelPriceEurPerL: input.fuelPriceEurPerL,
	});
	mob.iceLiters = ice.liters;
	mob.iceCostEur = ice.costEur;
	mob.iceFuelPriceEurPerL = input.fuelPriceEurPerL;
	mob.savingsVsIceEur =
		mob.evTotalCostEur !== null && ice.costEur !== null
			? round2(ice.costEur - mob.evTotalCostEur)
			: null;
}
