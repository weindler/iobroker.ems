import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function str(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
		setDefaultIfEmpty: true,
	};
}

function num(id: string, name: string, unit?: string): StateDef {
	return { id, common: { name, type: "number", role: "value", read: true, write: false, unit } };
}

export async function ensureEnergyforecastStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.energyforecast", "EMS-Light Energyforecast (Strompreis-Prognose)");
	await ensureStates(host, [
		str("learning.energyforecast.status", "Energyforecast Status (disabled|no_token|ok|error)", "disabled"),
		str("learning.energyforecast.status_de", "Energyforecast Hinweis"),
		str("learning.energyforecast.plan", "Energyforecast Tarif laut Antwort"),
		num("learning.energyforecast.days_ahead", "Energyforecast volle Tage nach heute", "d"),
		num("learning.energyforecast.price_now", "Energyforecast Gesamtpreis aktuelle Viertelstunde", "ct/kWh"),
		str("learning.energyforecast.compare_json", "Energyforecast Prognose gegen echte Preise (JSON)"),
	]);
}
