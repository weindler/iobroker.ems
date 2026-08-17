import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function numState(id: string, name: string, unit?: string): StateDef {
	return {
		id,
		common: {
			name,
			type: "number",
			role: "value",
			read: true,
			write: false,
			unit,
		},
	};
}

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

export async function ensurePriceLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.price_learning", "EMS-Light Learning Price");

	const defs: StateDef[] = [
		strState("learning.price_learning.status", "Price-Learning Status", "not_initialized"),
		strState("learning.price_learning.health", "Price-Learning Health", "degraded"),
		strState("learning.price_learning.last_run", "Price-Learning letzter Lauf (ISO)"),
		numState("learning.price_learning.confidence", "Price-Learning Confidence", "%"),
		numState("learning.price_learning.sample_days", "Price-Learning gültige Tage"),
		numState("learning.price_learning.avg_price_7d", "Price-Learning Ø 7d", "€/kWh"),
		numState("learning.price_learning.avg_price_30d", "Price-Learning Ø 30d", "€/kWh"),
		strState("learning.price_learning.error", "Price-Learning Fehler"),
	];

	await ensureStates(host, defs);
}
