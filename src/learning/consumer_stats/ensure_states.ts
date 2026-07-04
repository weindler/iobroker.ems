import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";
import { addonBase } from "../../tree_paths";

function numState(id: string, name: string, def?: number): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def, unit: id.endsWith("_kwh") ? "kWh" : "s" },
		defaultVal: def,
	};
}

function boolState(id: string, name: string, def?: boolean): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "switch", read: true, write: false, def },
		defaultVal: def,
	};
}

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
		defaultVal: def,
	};
}

export function consumerStatsBase(addonId: string): string {
	return `${addonBase(addonId)}.stats`;
}

export function consumerStatsStateIds(addonId: string): Record<string, string> {
	const base = consumerStatsBase(addonId);
	return {
		tracking: `${base}.tracking`,
		deviceActive: `${base}.device_active`,
		todayRuntimeSec: `${base}.today_runtime_sec`,
		todayEnergyKwh: `${base}.today_energy_kwh`,
		totalRuntimeSec: `${base}.total_runtime_sec`,
		totalEnergyKwh: `${base}.total_energy_kwh`,
		sessionRuntimeSec: `${base}.session_runtime_sec`,
		sessionEnergyKwh: `${base}.session_energy_kwh`,
		lastSessionRuntimeSec: `${base}.last_session_runtime_sec`,
		lastSessionEnergyKwh: `${base}.last_session_energy_kwh`,
		lastUpdated: `${base}.last_updated`,
	};
}

const CONSUMER_LABELS: Record<string, string> = {
	immersion_heater: "Heizstab",
};

export async function ensureConsumerStatsStates(host: StateHost, addonId: string): Promise<void> {
	const label = CONSUMER_LABELS[addonId] ?? addonId;
	const base = consumerStatsBase(addonId);
	const ids = consumerStatsStateIds(addonId);
	await ensureChannel(host, base, `${label} Statistik`);
	const defs: StateDef[] = [
		boolState(ids.tracking, `${label} Statistik aktiv`, false),
		boolState(ids.deviceActive, `${label} läuft (EMS)`, false),
		numState(ids.todayRuntimeSec, `${label} Laufzeit heute`, 0),
		numState(ids.todayEnergyKwh, `${label} Verbrauch heute`, 0),
		numState(ids.totalRuntimeSec, `${label} Laufzeit gesamt`, 0),
		numState(ids.totalEnergyKwh, `${label} Verbrauch gesamt`, 0),
		numState(ids.sessionRuntimeSec, `${label} aktuelle Session Laufzeit`, 0),
		numState(ids.sessionEnergyKwh, `${label} aktuelle Session Verbrauch`, 0),
		numState(ids.lastSessionRuntimeSec, `${label} letzte Session Laufzeit`, 0),
		numState(ids.lastSessionEnergyKwh, `${label} letzte Session Verbrauch`, 0),
		strState(ids.lastUpdated, `${label} Statistik aktualisiert`, ""),
	];
	await ensureStates(host, defs);
}
