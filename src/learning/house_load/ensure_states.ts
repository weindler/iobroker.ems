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

export async function ensureHouseLoadLearningStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.house_load", "EMS-Light Learning Hauslast");

	const defs: StateDef[] = [
		strState("learning.house_load.status", "House-Load-Learning Status", "not_initialized"),
		strState("learning.house_load.last_update", "House-Load-Learning letztes Update (ISO)"),
		numState("learning.house_load.sample_count", "House-Load-Learning Samples"),
		numState("learning.house_load.sample_days", "House-Load-Learning Sample-Tage"),
		numState("learning.house_load.confidence", "House-Load-Learning Confidence", "%"),
		strState("learning.house_load.current_segment", "House-Load aktuelles Segment"),
		strState("learning.house_load.current_season", "House-Load aktuelle Saison"),
		strState("learning.house_load.current_weekday", "House-Load aktueller Wochentag"),
		strState("learning.house_load.current_day_type", "House-Load Day-Type"),
		strState("learning.house_load.profile_json", "House-Load Profil (JSON)"),
		strState("learning.house_load.forecast_today_json", "House-Load Forecast heute (JSON)"),
		strState("learning.house_load.forecast_tomorrow_json", "House-Load Forecast morgen (JSON)"),
		strState("learning.house_load.health_json", "House-Load Health (JSON)"),
		strState("learning.house_load.source_state", "House-Load Quell-State"),
		strState("learning.house_load.history_mode", "House-Load Datenquelle (ems_rollup|aggregate_hourly|onchange_raw)"),
		strState("learning.house_load.error", "House-Load Fehler"),
	];

	await ensureStates(host, defs);
}
