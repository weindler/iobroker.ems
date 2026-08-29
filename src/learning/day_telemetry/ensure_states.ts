import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";
import { DAY_TELEMETRY_STATES } from "./constants";

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

export async function ensureDayTelemetryStates(host: StateHost): Promise<void> {
	await ensureChannel(host, "learning.day_telemetry", "EMS-Light Tages-Telemetrie");
	const defs: StateDef[] = [
		strState(DAY_TELEMETRY_STATES.status, "Tages-Telemetrie Status", "idle"),
		strState(DAY_TELEMETRY_STATES.lastSlotWrittenAt, "Tages-Telemetrie letzter Slot (ISO)"),
		boolState(DAY_TELEMETRY_STATES.recoveryPending, "Tages-Telemetrie Recovery ausstehend", false),
	];
	await ensureStates(host, defs);
}

export const DAY_TELEMETRY_STATE_IDS = Object.values(DAY_TELEMETRY_STATES);
