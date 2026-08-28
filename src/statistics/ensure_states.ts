import { ensureChannel, ensureStates, type StateHost } from "../ems_light/state_util";
import { STATISTICS_FLAT, type HomeFlatIds, type MobilityFlatIds } from "./flat_states";

export const STATISTICS_BASE = "statistics";

export const STATISTICS_STATES = {
	enabled: `${STATISTICS_BASE}.enabled`,
	lastRunAt: `${STATISTICS_BASE}.last_run_at`,
	reasonDe: `${STATISTICS_BASE}.reason_de`,
	configJson: `${STATISTICS_BASE}.config_json`,
	homeTodayJson: `${STATISTICS_BASE}.home.today_json`,
	homeMonthJson: `${STATISTICS_BASE}.home.month_json`,
	homePeriodJson: `${STATISTICS_BASE}.home.period_json`,
	mobilityTodayJson: `${STATISTICS_BASE}.mobility.today_json`,
	mobilityMonthJson: `${STATISTICS_BASE}.mobility.month_json`,
	mobilityPeriodJson: `${STATISTICS_BASE}.mobility.period_json`,
	homeTodaySavingsEur: `${STATISTICS_BASE}.home.today_savings_vs_fixed_eur`,
	homeMonthSavingsEur: `${STATISTICS_BASE}.home.month_savings_vs_fixed_eur`,
	homePeriodSavingsEur: `${STATISTICS_BASE}.home.period_savings_vs_fixed_eur`,
	mobilityTodaySavingsEur: `${STATISTICS_BASE}.mobility.today_savings_vs_ice_eur`,
	mobilityMonthSavingsEur: `${STATISTICS_BASE}.mobility.month_savings_vs_ice_eur`,
	mobilityPeriodSavingsEur: `${STATISTICS_BASE}.mobility.period_savings_vs_ice_eur`,
	periodId: `${STATISTICS_BASE}.period_id`,
	periodOptionsJson: `${STATISTICS_BASE}.period_options_json`,
	publicPendingJson: `${STATISTICS_BASE}.public_charge.pending_json`,
	publicSubmitRequest: `${STATISTICS_BASE}.public_charge.submit_request`,
	publicSubmitAckDe: `${STATISTICS_BASE}.public_charge.submit_ack_de`,
	adjustRequest: `${STATISTICS_BASE}.adjust_request`,
	adjustAckDe: `${STATISTICS_BASE}.adjust_ack_de`,
} as const;

function numState(id: string, name: string, unit?: string) {
	return {
		id,
		common: {
			name,
			type: "number" as const,
			role: "value",
			read: true,
			write: false,
			def: null as unknown as number,
			...(unit ? { unit } : {}),
		},
		defaultVal: null as unknown as ioBroker.StateValue,
		setDefaultIfEmpty: true,
	};
}

function strState(id: string, name: string, def = "") {
	return {
		id,
		common: {
			name,
			type: "string" as const,
			role: "text",
			read: true,
			write: false,
			def,
		},
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function boolState(id: string, name: string, def: boolean) {
	return {
		id,
		common: {
			name,
			type: "boolean" as const,
			role: "indicator",
			read: true,
			write: false,
			def,
		},
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function homeFlatStates(ids: HomeFlatIds, scopeDe: string) {
	return [
		numState(ids.gridImportKwh, `Haus ${scopeDe} Netzbezug`, "kWh"),
		numState(ids.tibberEur, `Haus ${scopeDe} Tibber`, "EUR"),
		numState(ids.fixedEur, `Haus ${scopeDe} Festtarif`, "EUR"),
		numState(ids.rewardsEur, `Haus ${scopeDe} Rewards`, "EUR"),
		strState(ids.rewardsSource, `Haus ${scopeDe} Rewards-Quelle`),
		numState(ids.savingsEur, `Haus ${scopeDe} Ersparnis vs. Festtarif`, "EUR"),
		strState(ids.labelDe, `Haus ${scopeDe} Label`),
		strState(ids.fromKey, `Haus ${scopeDe} von (YYYY-MM-DD)`),
		strState(ids.toKey, `Haus ${scopeDe} bis (YYYY-MM-DD)`),
	];
}

function mobilityFlatStates(ids: MobilityFlatIds, scopeDe: string) {
	return [
		numState(ids.homePvKwh, `Mobilität ${scopeDe} Heim PV`, "kWh"),
		numState(ids.homeGridKwh, `Mobilität ${scopeDe} Heim Netz`, "kWh"),
		numState(ids.homeGridCostEur, `Mobilität ${scopeDe} Heim Netz brutto`, "EUR"),
		numState(ids.homeGridCostNetEur, `Mobilität ${scopeDe} Heim Netz netto`, "EUR"),
		numState(ids.publicInvoicedKwh, `Mobilität ${scopeDe} Schnellader`, "kWh"),
		numState(ids.estimatedKm, `Mobilität ${scopeDe} km ≈`, "km"),
		numState(ids.evCostEur, `Mobilität ${scopeDe} E-Auto`, "EUR"),
		numState(ids.iceCostEur, `Mobilität ${scopeDe} Verbrenner`, "EUR"),
		numState(ids.fuelPriceEurPerL, `Mobilität ${scopeDe} Sprit`, "EUR/l"),
		numState(ids.savingsEur, `Mobilität ${scopeDe} Ersparnis vs. Verbrenner`, "EUR"),
		strState(ids.rewardsSource, `Mobilität ${scopeDe} Rewards-Quelle`),
		strState(ids.labelDe, `Mobilität ${scopeDe} Label`),
		strState(ids.fromKey, `Mobilität ${scopeDe} von (YYYY-MM-DD)`),
		strState(ids.toKey, `Mobilität ${scopeDe} bis (YYYY-MM-DD)`),
	];
}

export async function ensureStatisticsStateTree(host: StateHost): Promise<void> {
	await ensureChannel(host, STATISTICS_BASE, "EMS-Light Statistik (Reporting)");
	await ensureChannel(host, `${STATISTICS_BASE}.home`, "Statistik Haus / Tarifvergleich");
	await ensureChannel(host, `${STATISTICS_BASE}.home.today`, "Haus heute (flache States)");
	await ensureChannel(host, `${STATISTICS_BASE}.home.period`, "Haus Periode (flache States)");
	await ensureChannel(host, `${STATISTICS_BASE}.mobility`, "Statistik Mobilität E-Auto vs. Verbrenner");
	await ensureChannel(host, `${STATISTICS_BASE}.mobility.today`, "Mobilität heute (flache States)");
	await ensureChannel(host, `${STATISTICS_BASE}.mobility.period`, "Mobilität Periode (flache States)");
	await ensureChannel(host, `${STATISTICS_BASE}.public_charge`, "Statistik Schnellader / manuelle Rechnung");

	await ensureStates(host, [
		boolState(STATISTICS_STATES.enabled, "Statistik-Sidecar aktiv", true),
		strState(STATISTICS_STATES.lastRunAt, "Statistik letzter Lauf (ISO)"),
		strState(STATISTICS_STATES.reasonDe, "Statistik Hinweis (DE)", "Noch kein Lauf."),
		strState(STATISTICS_STATES.configJson, "Statistik wirksame Config (JSON)", "{}"),
		strState(STATISTICS_FLAT.statisticsStartDate, "Wirksames Statistik-Startdatum (YYYY-MM-DD)"),
		strState(STATISTICS_STATES.homeTodayJson, "Haus heute Vergleich (JSON)", "{}"),
		strState(STATISTICS_STATES.homeMonthJson, "Haus Monat Vergleich (JSON)", "{}"),
		strState(STATISTICS_STATES.homePeriodJson, "Haus Periode Vergleich (JSON)", "{}"),
		strState(STATISTICS_STATES.mobilityTodayJson, "Mobilität heute (JSON)", "{}"),
		strState(STATISTICS_STATES.mobilityMonthJson, "Mobilität Monat (JSON)", "{}"),
		strState(STATISTICS_STATES.mobilityPeriodJson, "Mobilität Periode Vergleich (JSON)", "{}"),
		numState(STATISTICS_STATES.homeTodaySavingsEur, "Haus heute Ersparnis vs. Festtarif (Legacy)", "EUR"),
		numState(STATISTICS_STATES.homeMonthSavingsEur, "Haus Monat Ersparnis vs. Festtarif (Legacy)", "EUR"),
		numState(STATISTICS_STATES.homePeriodSavingsEur, "Haus Periode Ersparnis vs. Festtarif (Legacy)", "EUR"),
		numState(STATISTICS_STATES.mobilityTodaySavingsEur, "Mobilität heute Ersparnis vs. Verbrenner (Legacy)", "EUR"),
		numState(STATISTICS_STATES.mobilityMonthSavingsEur, "Mobilität Monat Ersparnis vs. Verbrenner (Legacy)", "EUR"),
		numState(
			STATISTICS_STATES.mobilityPeriodSavingsEur,
			"Mobilität Periode Ersparnis vs. Verbrenner (Legacy)",
			"EUR",
		),
		...homeFlatStates(STATISTICS_FLAT.homeToday, "heute"),
		...homeFlatStates(STATISTICS_FLAT.homePeriod, "Periode"),
		...mobilityFlatStates(STATISTICS_FLAT.mobilityToday, "heute"),
		...mobilityFlatStates(STATISTICS_FLAT.mobilityPeriod, "Periode"),
		{
			id: STATISTICS_STATES.periodId,
			common: {
				name: "Statistik Zeitraum (z. B. this_month, last_7_days)",
				type: "string",
				role: "text",
				read: true,
				write: true,
				def: "this_month",
			},
			defaultVal: "this_month",
			setDefaultIfEmpty: true,
		},
		strState(STATISTICS_STATES.periodOptionsJson, "Statistik Zeitraum-Optionen (JSON)", "[]"),
		strState(STATISTICS_STATES.publicPendingJson, "Offene Schnellader-Sessions (JSON)", "[]"),
		{
			id: STATISTICS_STATES.publicSubmitRequest,
			common: {
				name: "Schnellader-Rechnung einreichen (JSON ack:false)",
				type: "string",
				role: "text",
				read: true,
				write: true,
				def: "",
			},
			defaultVal: "",
			setDefaultIfEmpty: true,
		},
		strState(STATISTICS_STATES.publicSubmitAckDe, "Schnellader-Rechnung Bestätigung (DE)"),
		{
			id: STATISTICS_STATES.adjustRequest,
			common: {
				name: "Statistik korrigieren / Startwerte (JSON ack:false)",
				type: "string",
				role: "text",
				read: true,
				write: true,
				def: "",
			},
			defaultVal: "",
			setDefaultIfEmpty: true,
		},
		strState(STATISTICS_STATES.adjustAckDe, "Statistik Korrektur Bestätigung (DE)"),
	]);
}
