import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function numState(id: string, name: string, def?: number): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def },
		defaultVal: def,
	};
}

function boolState(id: string, name: string, def?: boolean): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "state", read: true, write: false, def },
		defaultVal: def,
	};
}

export const GRID_SUPPLY_STATE_IDS = {
	status: "planner.intent.supply.grid.status",
	source: "planner.intent.supply.grid.source",
	generatedAt: "planner.intent.supply.grid.generated_at",
	validUntil: "planner.intent.supply.grid.valid_until",
	currentPriceCtPerKwh: "planner.intent.supply.grid.current_price_ct_per_kwh",
	importAllowed: "planner.intent.supply.grid.import_allowed",
	maxImportPowerW: "planner.intent.supply.grid.max_import_power_w",
	slotsJson: "planner.intent.supply.grid.slots_json",
	reasonDe: "planner.intent.supply.grid.reason_de",
	revision: "planner.intent.supply.grid.revision",
} as const;

export async function ensureGridSupplyStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "planner.intent.supply", "Planner Supply");
	await ensureChannel(host, "planner.intent.supply.grid", "Planner Grid Supply");

	const defs: StateDef[] = [
		strState(GRID_SUPPLY_STATE_IDS.status, "Grid Supply Status", "not_initialized"),
		strState(GRID_SUPPLY_STATE_IDS.source, "Grid Supply Quelle", "none"),
		strState(GRID_SUPPLY_STATE_IDS.generatedAt, "Grid Supply erzeugt (ISO)"),
		strState(GRID_SUPPLY_STATE_IDS.validUntil, "Grid Supply gültig bis (ISO)"),
		numState(GRID_SUPPLY_STATE_IDS.currentPriceCtPerKwh, "Grid Supply aktueller Preis ct/kWh"),
		boolState(GRID_SUPPLY_STATE_IDS.importAllowed, "Grid Supply Import erlaubt", false),
		numState(GRID_SUPPLY_STATE_IDS.maxImportPowerW, "Grid Supply max. Import W"),
		strState(GRID_SUPPLY_STATE_IDS.slotsJson, "Grid Supply Slots (JSON)", "[]"),
		strState(GRID_SUPPLY_STATE_IDS.reasonDe, "Grid Supply Begründung (DE)", ""),
		numState(GRID_SUPPLY_STATE_IDS.revision, "Grid Supply Revision", 0),
	];

	await ensureStates(host, defs);
}
