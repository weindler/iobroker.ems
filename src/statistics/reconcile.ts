import type { EnergeticDayTotals, EnergeticPeriodSummary, HouseCompareSummary, MobilityCompareSummary } from "./types";
import { iceCostForKm } from "./compute";

/** Netzmenge des Smart Meters ist die sichtbare Bezugsbasis; abweichende Tibber-Perioden bleiben markiert. */
export function reconcileHomeEnergy(
	home: HouseCompareSummary,
	energy: EnergeticDayTotals | EnergeticPeriodSummary | null | undefined,
	options: { preserveTibberMonthlyComparison?: boolean; feedInCtPerKwh?: number | null } = {},
): HouseCompareSummary {
	if (!energy || energy.gridImportKwh === null) return home;
	const same = home.gridImportKwh !== null && Math.abs(home.gridImportKwh - energy.gridImportKwh) <= 0.05;
	const separateTibberComparison = !same && options.preserveTibberMonthlyComparison === true &&
		home.gridImportKwh !== null && home.dynamicCostEur !== null &&
		home.fixedTariffCostEur !== null && home.savingsVsFixedEur !== null;
	const exportSame = home.gridExportKwh != null && energy.gridExportKwh !== null &&
		Math.abs(home.gridExportKwh - energy.gridExportKwh) <= 0.05;
	const meterFeedInCredit = energy.gridExportKwh !== null && energy.gridExportKwh >= 0 &&
		options.feedInCtPerKwh != null && options.feedInCtPerKwh >= 0
		? Math.round(energy.gridExportKwh * options.feedInCtPerKwh) / 100 : null;
	return {
		...home,
		gridImportKwh: energy.gridImportKwh,
		comparisonGridImportKwh: separateTibberComparison ? home.gridImportKwh : null,
		gridExportKwh: energy.gridExportKwh,
		feedInCreditEur: meterFeedInCredit ?? (exportSame ? home.feedInCreditEur : null),
		fixedTariffCostEur: same || separateTibberComparison ? home.fixedTariffCostEur : null,
		savingsVsFixedEur: same || separateTibberComparison ? home.savingsVsFixedEur : null,
		reasonDe: (same
			? "Netzbezug und Tibber-Kosten verwenden dieselbe gemessene Menge. "
			: separateTibberComparison
				? "Vorläufiger Preisvergleich auf Tibbers Monatsmenge; der Smart-Meter-Wert hat einen anderen Erfassungsstand. Beide Mengen werden getrennt ausgewiesen. "
				: "Smart-Meter-Netzbezug und Tibber-Kosten beziehen sich auf unterschiedliche Erfassungsstände; Festtarifvergleich bis zum gemeinsamen Datenstand derzeit nicht berechenbar. ") + home.reasonDe,
	};
}

/** Dieselbe Wallboxmessung für Energie- und Mobilitätskarte verwenden. */
export function reconcileMobilityEnergy(
	mobility: MobilityCompareSummary,
	energy: EnergeticDayTotals | EnergeticPeriodSummary | null | undefined,
	options: { iceLPer100Km?: number | null; tibberAvgEurPerKwh?: number | null; feedInCtPerKwh?: number | null } = {},
): MobilityCompareSummary {
	if (!energy || energy.evChargedKwh === null) {
		return {
			...mobility,
			homeChargedKwh: null,
			homePvKwh: null,
			homeBatteryKwh: null,
			homeGridKwh: null,
			estimatedKm: null,
			evTotalCostEur: null,
			iceCostEur: null,
			savingsVsIceEur: null,
			reasonDe: "Gemessene Wallboxenergie für diesen Zeitraum noch nicht verfügbar. " + mobility.reasonDe,
		};
	}
	const measured = energy.evChargedKwh;
	const legacy = (mobility.homePvKwh ?? 0) + (mobility.homeGridKwh ?? 0);
	const sameEnergy = Math.abs(measured - legacy) <= 0.05;
	const onlyFast = energy.evFastChargedKwh !== null && Math.abs(measured - energy.evFastChargedKwh) <= 0.05;
	const sourcesComplete = onlyFast && energy.evFastBatteryKwh !== null &&
		energy.evFastGridKwh !== null && energy.evFastLocalKwh !== null;
	const homeGridKwh = sourcesComplete ? energy.evFastGridKwh : null;
	const homeBatteryKwh = sourcesComplete ? energy.evFastBatteryKwh : null;
	const homePvKwh = energy.evPvKwh;
	const sourceMatchesLegacy = sourcesComplete && homeGridKwh !== null && homePvKwh !== null &&
		Math.abs(homeGridKwh - (mobility.homeGridKwh ?? 0)) <= 0.05 &&
		Math.abs(homePvKwh - (mobility.homePvKwh ?? 0)) <= 0.05;
	const costsKnown = sameEnergy && sourceMatchesLegacy;
	const chargedWithInvoice = measured + (mobility.publicInvoicedKwh ?? 0);
	const estimatedKm = mobility.evKwhPer100Km && mobility.evKwhPer100Km > 0
		? Math.round((chargedWithInvoice / mobility.evKwhPer100Km) * 100_000) / 1000
		: null;
	const iceCost = iceCostForKm({
		km: estimatedKm,
		lPer100Km: options.iceLPer100Km ?? null,
		fuelPriceEurPerL: mobility.fuelPriceEurPerL,
	}).costEur;
	// Vorläufiger Vergleich ohne unbelegte Batterie-/Netzzuordnung: der Nicht-PV-Anteil
	// wird mit dem mittleren Tibber-Preis bewertet. Nur reine Heimladung; keine
	// fremden Schnelllade-Rechnungen oder unbestätigten Rewards dazumischen.
	const canEstimate = (mobility.publicInvoicedKwh ?? 0) === 0 && (mobility.openPublicSessions ?? 0) === 0 &&
		homePvKwh !== null && homePvKwh >= 0 && homePvKwh <= measured + 0.05 &&
		options.tibberAvgEurPerKwh != null && options.tibberAvgEurPerKwh >= 0 &&
		options.feedInCtPerKwh != null && options.feedInCtPerKwh >= 0 && iceCost !== null;
	const estimatedEvCostEur = canEstimate
		? Math.round((homePvKwh! * options.feedInCtPerKwh! / 100 +
			Math.max(0, measured - homePvKwh!) * options.tibberAvgEurPerKwh!) * 100) / 100
		: null;
	return {
		...mobility,
		homeChargedKwh: measured,
		homePvKwh,
		homeBatteryKwh,
		homeGridKwh,
		homeGridCostEur: costsKnown ? mobility.homeGridCostEur : null,
		homeGridCostNetEur: costsKnown ? mobility.homeGridCostNetEur : null,
		estimatedKm,
		estimatedEvCostEur: costsKnown ? null : estimatedEvCostEur,
		estimatedSavingsVsIceEur: costsKnown || estimatedEvCostEur === null || iceCost === null
			? null : Math.round((iceCost - estimatedEvCostEur) * 100) / 100,
		evTotalCostEur: costsKnown ? mobility.evTotalCostEur : null,
		iceCostEur: costsKnown ? mobility.iceCostEur : iceCost,
		savingsVsIceEur: costsKnown ? mobility.savingsVsIceEur : null,
		reasonDe: (!sameEnergy || !sourceMatchesLegacy
			? "Wallboxenergie stammt aus der Tages-Telemetrie; Herkunft oder Kosten der bisherigen Sitzungszählung weichen ab. " +
				(estimatedEvCostEur === null
					? "Für eine Geldschätzung fehlen Preis- oder Verbrauchsdaten. "
					: "Die Schätzung bewertet PV mit Einspeisevergütung und den übrigen Heimladeanteil mit dem mittleren Tibber-Preis; Batterieanteil, Ladezeitpreise und Grid Rewards sind darin nicht gesondert berücksichtigt. ")
			: "Wallboxenergie und Sitzungszählung stimmen überein. ") + mobility.reasonDe,
	};
}
