import type { GridRewardsSource, HomeDayTotals, MobilityDayTotals } from "./types";
import type { ResolvedGridRewards } from "./grid_rewards";
import { netHomeGridCostEur } from "./grid_rewards";

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

/** TibberLink Consumption.jsonDaily — Summe kWh/Kosten für den Kalendermonat von dateKey. */
function tibberEntryDateKey(entry: Record<string, unknown>): string | null {
	const raw = entry.from ?? entry.to;
	return typeof raw === "string" ? raw : null;
}

function tibberEntryConsumptionKwh(entry: Record<string, unknown>): number | null {
	const c = Number(entry.consumption);
	return Number.isFinite(c) && c >= 0 ? c : null;
}

function tibberEntryCostEur(entry: Record<string, unknown>): number | null {
	const totalCost = Number(entry.totalCost);
	if (Number.isFinite(totalCost)) return totalCost;
	const cost = Number(entry.cost);
	if (Number.isFinite(cost)) return cost;
	const cons = tibberEntryConsumptionKwh(entry);
	const unitCost = Number(entry.unitCost);
	if (cons !== null && Number.isFinite(unitCost)) return cons * unitCost;
	return null;
}

export function sumTibberJsonDailyForMonth(
	raw: unknown,
	dateKey: string,
): { gridImportKwh: number | null; dynamicCostEur: number | null } {
	const prefix = dateKey.slice(0, 7);
	return sumTibberJsonDailyForRange(raw, `${prefix}-01`, `${prefix}-31`);
}

/** TibberLink jsonDaily — Summe für inklusives Datumsintervall. */
export function sumTibberJsonDailyForRange(
	raw: unknown,
	fromKey: string,
	toKey: string,
): { gridImportKwh: number | null; dynamicCostEur: number | null } {
	try {
		const arr = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
		if (!Array.isArray(arr)) return { gridImportKwh: null, dynamicCostEur: null };
		let kwh = 0;
		let cost = 0;
		let hits = 0;
		for (const entry of arr) {
			if (!entry || typeof entry !== "object") continue;
			const o = entry as Record<string, unknown>;
			const dateStr = tibberEntryDateKey(o);
			if (!dateStr || dateStr.length < 10) continue;
			const key = dateStr.slice(0, 10);
			if (key < fromKey || key > toKey) continue;
			const c = tibberEntryConsumptionKwh(o);
			const t = tibberEntryCostEur(o);
			if (c !== null) kwh += c;
			if (t !== null) cost += t;
			hits++;
		}
		if (!hits) return { gridImportKwh: null, dynamicCostEur: null };
		return { gridImportKwh: round3(kwh), dynamicCostEur: round2(cost) };
	} catch {
		return { gridImportKwh: null, dynamicCostEur: null };
	}
}

/** TibberLink Consumption.jsonMonthly — ein Monatseintrag (Fallback wenn jsonDaily leer). */
export function pickTibberJsonMonthlyForMonth(
	raw: unknown,
	dateKey: string,
): { gridImportKwh: number | null; dynamicCostEur: number | null } {
	try {
		const arr = typeof raw === "string" ? (JSON.parse(raw) as unknown) : raw;
		if (!Array.isArray(arr)) return { gridImportKwh: null, dynamicCostEur: null };
		const prefix = dateKey.slice(0, 7);
		for (const entry of arr) {
			if (!entry || typeof entry !== "object") continue;
			const o = entry as Record<string, unknown>;
			const dateStr = tibberEntryDateKey(o);
			if (!dateStr || !dateStr.startsWith(prefix)) continue;
			return {
				gridImportKwh: tibberEntryConsumptionKwh(o),
				dynamicCostEur: tibberEntryCostEur(o),
			};
		}
		return { gridImportKwh: null, dynamicCostEur: null };
	} catch {
		return { gridImportKwh: null, dynamicCostEur: null };
	}
}

/** Geschwister-State im selben Tibber-Home (jsonDaily → jsonMonthly / currentMonthConsumption). */
export function siblingTibberConsumptionState(stateId: string, leaf: string): string {
	if (!stateId.endsWith("jsonDaily")) return "";
	return `${stateId.slice(0, -"jsonDaily".length)}${leaf}`;
}

export function resolveHomeMonthFromTibber(input: {
	dateKey: string;
	jsonDailyRaw: unknown;
	jsonMonthlyRaw: unknown;
	currentMonthKwh: number | null;
	mappedMonthKwh: number | null;
	mappedMonthDynamicEur: number | null;
}): {
	gridImportKwh: number | null;
	dynamicCostEur: number | null;
	addTibberFeesToDynamic: boolean;
	source: "jsonDaily" | "jsonMonthly" | "currentMonthConsumption" | "mapped" | null;
} {
	const fromDaily = sumTibberJsonDailyForMonth(input.jsonDailyRaw, input.dateKey);
	if (fromDaily.gridImportKwh !== null || fromDaily.dynamicCostEur !== null) {
		// totalCost aus Tibber enthält bereits Tages-/Monatsanteile — nicht noch Tarif-Tab addieren.
		return { ...fromDaily, addTibberFeesToDynamic: false, source: "jsonDaily" };
	}
	const fromMonthly = pickTibberJsonMonthlyForMonth(input.jsonMonthlyRaw, input.dateKey);
	if (fromMonthly.gridImportKwh !== null || fromMonthly.dynamicCostEur !== null) {
		return {
			...fromMonthly,
			addTibberFeesToDynamic: false,
			source: "jsonMonthly",
		};
	}
	const kwh = input.currentMonthKwh ?? input.mappedMonthKwh;
	const dynamic = input.mappedMonthDynamicEur;
	if (kwh !== null || dynamic !== null) {
		return {
			gridImportKwh: kwh,
			dynamicCostEur: dynamic,
			addTibberFeesToDynamic: false,
			source: kwh !== null && input.currentMonthKwh !== null ? "currentMonthConsumption" : "mapped",
		};
	}
	return {
		gridImportKwh: null,
		dynamicCostEur: null,
		addTibberFeesToDynamic: false,
		source: null,
	};
}

/** Monats-Haus aus Live-Quellen (Tibber jsonDaily o. ä.) — Festtarif anteilig bis dateKey. */
export function buildHomeMonthTotals(input: {
	dateKey: string;
	gridImportKwh: number | null;
	dynamicCostEur: number | null;
	gridRewardsCreditEur: number | null;
	gridRewardsSource: GridRewardsSource;
	gridExportKwh: number | null;
	feedInCtPerKwh: number | null;
	compareTariffCtPerKwh: number | null;
	compareTariffMonthlyBaseEur: number | null;
	tibberMonthlyBaseEur: number | null;
	tibberMonthlyGridFeeEur: number | null;
	addTibberFeesToDynamic: boolean;
}): HomeDayTotals {
	const dayNum = Number.parseInt(input.dateKey.slice(8, 10), 10);
	const monthFracElapsed = dayNum / daysInMonth(input.dateKey);

	let dynamic = input.dynamicCostEur;
	if (dynamic !== null && input.addTibberFeesToDynamic) {
		const fees =
			dailyBaseShareEur(input.tibberMonthlyBaseEur, monthFracElapsed) +
			dailyBaseShareEur(input.tibberMonthlyGridFeeEur, monthFracElapsed);
		dynamic = round2(dynamic + fees);
	}

	const fixed = fixedTariffCostEur({
		gridImportKwh: input.gridImportKwh,
		compareTariffCtPerKwh: input.compareTariffCtPerKwh,
		monthlyBaseEur: input.compareTariffMonthlyBaseEur,
		monthFraction: monthFracElapsed,
	});

	let feedIn: number | null = null;
	if (input.gridExportKwh !== null && input.feedInCtPerKwh !== null && input.feedInCtPerKwh >= 0) {
		feedIn = round2((input.gridExportKwh * input.feedInCtPerKwh) / 100);
	}

	return {
		dateKey: input.dateKey,
		gridImportKwh: input.gridImportKwh,
		gridExportKwh: input.gridExportKwh,
		dynamicCostEur: dynamic,
		fixedTariffCostEur: fixed,
		gridRewardsCreditEur: input.gridRewardsCreditEur,
		gridRewardsSource: input.gridRewardsSource,
		feedInCreditEur: feedIn,
		savingsVsFixedEur: savingsVsFixedEur(fixed, dynamic, input.gridRewardsCreditEur),
	};
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

export function applyHomeGridRewards(
	home: HomeDayTotals,
	rewards: ResolvedGridRewards,
): HomeDayTotals {
	const credit = rewards.source === "off" ? null : rewards.creditEur;
	return {
		...home,
		gridRewardsCreditEur: credit,
		gridRewardsSource: rewards.source,
		savingsVsFixedEur: savingsVsFixedEur(home.fixedTariffCostEur, home.dynamicCostEur, credit),
	};
}

export function applyMobilityGridRewards(
	mob: MobilityDayTotals,
	rewards: ResolvedGridRewards,
): MobilityDayTotals {
	if (rewards.source === "off" || rewards.creditEur === null) {
		return {
			...mob,
			homeGridCostNetEur: mob.homeGridCostEur,
			gridRewardsCreditEur: null,
			gridRewardsSource: "off",
		};
	}
	const credit = rewards.creditEur;
	const homeGridNet = netHomeGridCostEur(mob.homeGridCostEur, credit);
	const parts = [mob.homePvCostEur, mob.homeGridCostEur, mob.publicInvoicedEur].filter(
		(v): v is number => v !== null,
	);
	const chargeKwh =
		(mob.homePvKwh ?? 0) + (mob.homeGridKwh ?? 0) + (mob.publicInvoicedKwh ?? 0);
	let evTotalCostEur = mob.evTotalCostEur;
	if (parts.length > 0 || credit > 0) {
		evTotalCostEur = round2(Math.max(0, parts.reduce((a, b) => a + b, 0) - credit));
	}
	if (chargeKwh <= 0 && !(mob.publicInvoicedEur ?? 0) && credit <= 0) {
		evTotalCostEur = mob.evTotalCostEur;
	}
	const iceCost = mob.iceCostEur;
	return {
		...mob,
		homeGridCostNetEur: homeGridNet,
		gridRewardsCreditEur: credit,
		gridRewardsSource: rewards.source,
		evTotalCostEur,
		savingsVsIceEur:
			evTotalCostEur !== null && iceCost !== null
				? round2(iceCost - evTotalCostEur)
				: mob.savingsVsIceEur,
	};
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
		gridRewardsSource: "off",
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
		homeGridCostNetEur: null,
		gridRewardsCreditEur: null,
		gridRewardsSource: "off",
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
	const billingDay = [...days].reverse().find((d) => d.gridRewardsSource === "billing");
	return {
		dateKey,
		gridImportKwh: importKwh,
		gridExportKwh: sum((d) => d.gridExportKwh),
		dynamicCostEur: dynamic,
		fixedTariffCostEur: fixed,
		savingsVsFixedEur: savingsVsFixedEur(fixed, dynamic, rewards),
		gridRewardsCreditEur: rewards,
		gridRewardsSource: billingDay?.gridRewardsSource ?? "estimate_day",
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
	monthGridRewards?: ResolvedGridRewards,
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
	if (monthGridRewards && monthGridRewards.source !== "off" && monthGridRewards.creditEur !== null) {
		const grossParts = [homePvCostEur, homeGridCostEur, publicInvoicedEur].filter(
			(v): v is number => v !== null,
		);
		if (grossParts.length > 0 || monthGridRewards.creditEur > 0) {
			evCost = round2(
				Math.max(0, grossParts.reduce((a, b) => a + b, 0) - monthGridRewards.creditEur),
			);
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

	const displayFuelPrice = monthRepresentativeFuelPriceEurPerL(
		days,
		evKwhPer100,
		fuelPrice,
	);

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

	const monthRewardsCredit =
		monthGridRewards && monthGridRewards.source !== "off"
			? monthGridRewards.creditEur
			: sum((d) => d.gridRewardsCreditEur);
	const monthRewardsSource =
		monthGridRewards && monthGridRewards.source !== "off"
			? monthGridRewards.source
			: [...days].reverse().find((d) => d.gridRewardsSource !== "off")?.gridRewardsSource ?? "off";
	const homeGridNet = netHomeGridCostEur(homeGridCostEur, monthRewardsCredit);

	return {
		dateKey,
		homePvKwh,
		homeGridKwh,
		homePvCostEur,
		homeGridCostEur,
		homeGridCostNetEur: homeGridNet,
		gridRewardsCreditEur: monthRewardsCredit,
		gridRewardsSource: monthRewardsSource,
		publicInvoicedKwh,
		publicInvoicedEur,
		publicPendingKwh: sum((d) => d.publicPendingKwh),
		evTotalCostEur: evCost,
		evKwhPer100Km: evKwhPer100,
		evKwhPer100KmSource:
			monthFinalize?.evKwhPer100KmSource ?? lastWithSrc?.evKwhPer100KmSource ?? null,
		estimatedKm,
		iceLiters,
		iceFuelPriceEurPerL: displayFuelPrice,
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

function monthRepresentativeFuelPriceEurPerL(
	days: MobilityDayTotals[],
	evKwhPer100: number | null,
	defaultFuelPriceEurPerL: number | null,
): number | null {
	let weightedSum = 0;
	let totalKm = 0;
	for (const d of days) {
		const fp = d.iceFuelPriceEurPerL ?? defaultFuelPriceEurPerL;
		const km = mobilityDayEstimatedKm(d, evKwhPer100);
		if (fp !== null && fp > 0 && km !== null && km > 0) {
			weightedSum += fp * km;
			totalKm += km;
		}
	}
	if (totalKm > 0) return round3(weightedSum / totalKm);
	return defaultFuelPriceEurPerL ?? [...days].reverse().find((d) => d.iceFuelPriceEurPerL)?.iceFuelPriceEurPerL ?? null;
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
