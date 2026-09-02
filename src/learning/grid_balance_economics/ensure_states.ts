import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

const BASE = "learning.grid_balance_economics";

export const GRID_BALANCE_ECONOMICS_STATE_IDS = {
	status: `${BASE}.status`,
	lastRun: `${BASE}.last_run`,
	usable: `${BASE}.usable`,
	alpha: `${BASE}.alpha`,
	beta: `${BASE}.beta`,
	confidence: `${BASE}.confidence`,
	pairCount: `${BASE}.pair_count`,
	reasonDe: `${BASE}.reason_de`,
	etaPvPath: `${BASE}.eta_pv_path`,
	etaGridPath: `${BASE}.eta_grid_path`,
	etaPvUsable: `${BASE}.eta_pv_usable`,
	etaGridUsable: `${BASE}.eta_grid_usable`,
	etaReasonDe: `${BASE}.eta_reason_de`,
} as const;

function numState(id: string, name: string): StateDef {
	return { id, common: { name, type: "number", role: "value", read: true, write: false } };
}
function strState(id: string, name: string, def = ""): StateDef {
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

export async function ensureGridBalanceEconomicsStates(host: StateHost): Promise<void> {
	await ensureChannel(host, BASE, "EMS-Light Learning Grid-Balance-Economics");
	const S = GRID_BALANCE_ECONOMICS_STATE_IDS;
	await ensureStates(host, [
		strState(S.status, "GB-Economics Status", "not_initialized"),
		strState(S.lastRun, "GB-Economics letzter Lauf (ISO)"),
		boolState(S.usable, "GB-Economics belastbar", false),
		numState(S.alpha, "GB-Economics α (vermiedener Import / GB-kWh)"),
		numState(S.beta, "GB-Economics β (extra Batterie / GB-kWh)"),
		numState(S.confidence, "GB-Economics Confidence"),
		numState(S.pairCount, "GB-Economics Vergleichspaare"),
		strState(S.reasonDe, "GB-Economics Begründung"),
		numState(S.etaPvPath, "GB-Economics η PV-Pfad"),
		numState(S.etaGridPath, "GB-Economics η Netz-Pfad"),
		boolState(S.etaPvUsable, "GB-Economics η PV usable", false),
		boolState(S.etaGridUsable, "GB-Economics η Netz usable", false),
		strState(S.etaReasonDe, "GB-Economics η Begründung"),
	]);
}
