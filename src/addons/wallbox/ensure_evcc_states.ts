import { addonStatusBase } from "../../tree_paths";
import type { StateHost } from "../../ems_light/state_util";
import { ensureStates, type StateDef } from "../../ems_light/state_util";

const EVCC_BASE = `${addonStatusBase("wallbox")}.evcc`;

export const WALLBOX_EVCC_STATES = {
	snapshotJson: `${EVCC_BASE}.snapshot_json`,
	updatedAt: `${EVCC_BASE}.updated_at`,
	enabled: `${EVCC_BASE}.enabled`,
	connected: `${EVCC_BASE}.connected`,
	charging: `${EVCC_BASE}.charging`,
	chargePowerW: `${EVCC_BASE}.charge_power_w`,
	sessionEnergyKwh: `${EVCC_BASE}.session_energy_kwh`,
	vehicleSocPct: `${EVCC_BASE}.vehicle_soc_pct`,
	planActive: `${EVCC_BASE}.plan_active`,
	planSocPct: `${EVCC_BASE}.plan_soc_pct`,
	planTime: `${EVCC_BASE}.plan_time`,
	effectivePlanTime: `${EVCC_BASE}.effective_plan_time`,
	activePhases: `${EVCC_BASE}.active_phases`,
	configuredPhases: `${EVCC_BASE}.configured_phases`,
	minCurrentA: `${EVCC_BASE}.min_current_a`,
	maxCurrentA: `${EVCC_BASE}.max_current_a`,
} as const;

export async function ensureWallboxEvccStates(host: StateHost): Promise<void> {
	const defs: StateDef[] = [
		{
			id: WALLBOX_EVCC_STATES.snapshotJson,
			common: {
				name: "Wallbox EVCC Snapshot (JSON)",
				type: "string",
				role: "json",
				read: true,
				write: false,
			},
		},
		{
			id: WALLBOX_EVCC_STATES.updatedAt,
			common: { name: "Wallbox EVCC zuletzt gelesen", type: "string", role: "date", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.enabled,
			common: { name: "EVCC Ladefreigabe", type: "boolean", role: "state", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.connected,
			common: { name: "EVCC Fahrzeug angeschlossen", type: "boolean", role: "state", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.charging,
			common: { name: "EVCC Laden aktiv", type: "boolean", role: "state", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.chargePowerW,
			common: {
				name: "EVCC Ladeleistung",
				type: "number",
				role: "value.power",
				unit: "W",
				read: true,
				write: false,
			},
		},
		{
			id: WALLBOX_EVCC_STATES.sessionEnergyKwh,
			common: {
				name: "EVCC Sitzungsenergie",
				type: "number",
				role: "value",
				unit: "kWh",
				read: true,
				write: false,
			},
		},
		{
			id: WALLBOX_EVCC_STATES.vehicleSocPct,
			common: {
				name: "EVCC Fahrzeug-SOC",
				type: "number",
				role: "value.battery",
				unit: "%",
				read: true,
				write: false,
			},
		},
		{
			id: WALLBOX_EVCC_STATES.planActive,
			common: { name: "EVCC Plan aktiv", type: "boolean", role: "state", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.planSocPct,
			common: {
				name: "EVCC Plan-Ziel-SOC",
				type: "number",
				role: "value.battery",
				unit: "%",
				read: true,
				write: false,
			},
		},
		{
			id: WALLBOX_EVCC_STATES.planTime,
			common: { name: "EVCC Planzeit", type: "string", role: "date", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.effectivePlanTime,
			common: { name: "EVCC effectivePlanTime", type: "string", role: "date", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.activePhases,
			common: { name: "EVCC aktive Phasen", type: "number", role: "value", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.configuredPhases,
			common: { name: "EVCC konfigurierte Phasen", type: "number", role: "value", read: true, write: false },
		},
		{
			id: WALLBOX_EVCC_STATES.minCurrentA,
			common: {
				name: "EVCC minimaler Ladestrom",
				type: "number",
				role: "value.current",
				unit: "A",
				read: true,
				write: false,
			},
		},
		{
			id: WALLBOX_EVCC_STATES.maxCurrentA,
			common: {
				name: "EVCC maximaler Ladestrom",
				type: "number",
				role: "value.current",
				unit: "A",
				read: true,
				write: false,
			},
		},
	];

	await ensureStates(host, defs);
}
