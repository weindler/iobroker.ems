import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";

function numState(id: string, name: string, unit?: string): StateDef {
	return { id, common: { name, type: "number", role: "value", read: true, write: false, unit } };
}
function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}
function boolState(id: string, name: string, def = false): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "indicator", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

export const ECONOMICS_STATES = {
	enabled: "economics.enabled",
	lastRunAt: "economics.last_run_at",
	reasonDe: "economics.reason_de",
	periodId: "economics.period_id",
} as const;

/** Flache Kennzahlen fürs Betriebsseiten-Dashboard — kein JSON-Parsing in der einfachen VIS-Ansicht. */
export const ECONOMICS_FLAT = {
	todayTarifvorteilEur: "economics.today.tarifvorteil_eur",
	todayEmsVorteilEur: "economics.today.ems_vorteil_eur",
	todayKiMehrwertEur: "economics.today.ki_mehrwert_eur",
	todayGridRewardsEur: "economics.today.grid_rewards_eur",
	periodTarifvorteilEur: "economics.period.tarifvorteil_eur",
	periodEmsVorteilEur: "economics.period.ems_vorteil_eur",
	periodKiMehrwertEur: "economics.period.ki_mehrwert_eur",
	periodGridRewardsEur: "economics.period.grid_rewards_eur",
	periodLabelDe: "economics.period.label_de",
	cumulativeTarifvorteilEur: "economics.cumulative.tarifvorteil_eur",
	cumulativeEmsVorteilEur: "economics.cumulative.ems_vorteil_eur",
	cumulativeKiMehrwertEur: "economics.cumulative.ki_mehrwert_eur",
	cumulativeGridRewardsEur: "economics.cumulative.grid_rewards_eur",
} as const;

export async function ensureEconomicsStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "economics", "EMS-Light Wirtschaftlichkeit (Phase 7)");
	await ensureChannel(host, "economics.today", "Wirtschaftlichkeit heute");
	await ensureChannel(host, "economics.period", "Wirtschaftlichkeit Zeitraum");
	await ensureChannel(host, "economics.cumulative", "Wirtschaftlichkeit kumuliert (seit Statistik-Start)");

	const defs: StateDef[] = [
		boolState(ECONOMICS_STATES.enabled, "Wirtschaftlichkeit aktiv"),
		strState(ECONOMICS_STATES.lastRunAt, "Wirtschaftlichkeit letzter Lauf (ISO)"),
		strState(ECONOMICS_STATES.reasonDe, "Wirtschaftlichkeit Status/Begründung", ""),
		strState(ECONOMICS_STATES.periodId, "Wirtschaftlichkeit Zeitraum-Auswahl", "this_month"),

		numState(ECONOMICS_FLAT.todayTarifvorteilEur, "Tarifvorteil heute", "EUR"),
		numState(ECONOMICS_FLAT.todayEmsVorteilEur, "EMS-Effekt heute (positiv = gespart)", "EUR"),
		numState(ECONOMICS_FLAT.todayKiMehrwertEur, "KI-Mehrwert heute", "EUR"),
		numState(ECONOMICS_FLAT.todayGridRewardsEur, "Grid Rewards heute", "EUR"),
		numState(ECONOMICS_FLAT.periodTarifvorteilEur, "Tarifvorteil Zeitraum", "EUR"),
		numState(ECONOMICS_FLAT.periodEmsVorteilEur, "EMS-Effekt Zeitraum (positiv = gespart)", "EUR"),
		numState(ECONOMICS_FLAT.periodKiMehrwertEur, "KI-Mehrwert Zeitraum", "EUR"),
		numState(ECONOMICS_FLAT.periodGridRewardsEur, "Grid Rewards Zeitraum", "EUR"),
		strState(ECONOMICS_FLAT.periodLabelDe, "Zeitraum-Bezeichnung", ""),
		numState(ECONOMICS_FLAT.cumulativeTarifvorteilEur, "Tarifvorteil kumuliert", "EUR"),
		numState(ECONOMICS_FLAT.cumulativeEmsVorteilEur, "EMS-Effekt kumuliert (positiv = gespart)", "EUR"),
		numState(ECONOMICS_FLAT.cumulativeKiMehrwertEur, "KI-Mehrwert kumuliert", "EUR"),
		numState(ECONOMICS_FLAT.cumulativeGridRewardsEur, "Grid Rewards kumuliert", "EUR"),
	];
	await ensureStates(host, defs);
}
