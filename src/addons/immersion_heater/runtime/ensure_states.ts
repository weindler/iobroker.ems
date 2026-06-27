import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../../ems_light/state_util";
import { IMMERSION_RUNTIME_BASE, IMMERSION_RUNTIME_STATES } from "./types";

function strState(id: string, name: string, def?: string, write = false, extendCommon?: boolean): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: !write, write, def },
		defaultVal: def,
		setDefaultIfEmpty: !write,
		extendCommon,
	};
}

function numState(id: string, name: string, def?: number): StateDef {
	return {
		id,
		common: { name, type: "number", role: "value", read: true, write: false, def },
		defaultVal: def,
	};
}

function boolState(id: string, name: string, def?: boolean, write = false): StateDef {
	return {
		id,
		common: { name, type: "boolean", role: "switch", read: !write, write, def },
		defaultVal: def,
	};
}

const MODE_STATES = ["off", "auto", "force"] as const;

export async function ensureImmersionRuntimeStates(host: StateHost): Promise<void> {
	await ensureChannel(host, IMMERSION_RUNTIME_BASE, "Heizstab Runtime");
	const defs: StateDef[] = [
		boolState(IMMERSION_RUNTIME_STATES.available, "Heizstab verfügbar", false),
		strState(IMMERSION_RUNTIME_STATES.state, "Heizstab Runtime-Zustand", "disabled"),
		strState(IMMERSION_RUNTIME_STATES.requestedMode, "Heizstab angeforderter Modus", "auto", false, true),
		strState(IMMERSION_RUNTIME_STATES.resolvedMode, "Heizstab aufgelöster Modus", "auto"),
		numState(IMMERSION_RUNTIME_STATES.bufferTemperatureC, "Puffer-Temperatur °C"),
		strState(IMMERSION_RUNTIME_STATES.temperatureStatus, "Temperatur-Status", "missing"),
		numState(IMMERSION_RUNTIME_STATES.planningMinTempC, "Planungsuntergrenze °C"),
		numState(IMMERSION_RUNTIME_STATES.planningMaxTempC, "Planungsobergrenze °C"),
		numState(IMMERSION_RUNTIME_STATES.forceTargetTempC, "Force-Ziel °C"),
		strState(IMMERSION_RUNTIME_STATES.forceUntil, "Force bis (ISO)"),
		numState(IMMERSION_RUNTIME_STATES.commandedStage, "Befohlene Stufe", 0),
		numState(IMMERSION_RUNTIME_STATES.commandedPowerW, "Befohlene Leistung W", 0),
		numState(IMMERSION_RUNTIME_STATES.feedbackStage, "Rückgemeldete Stufe", 0),
		numState(IMMERSION_RUNTIME_STATES.measuredPowerW, "Gemessene Leistung W"),
		strState(IMMERSION_RUNTIME_STATES.powerVerificationStatus, "Leistungsprüfung", "unavailable"),
		numState(IMMERSION_RUNTIME_STATES.minRuntimeRemainingSec, "Mindestlaufzeit verbleibend s", 0),
		numState(IMMERSION_RUNTIME_STATES.minPauseRemainingSec, "Mindestpause verbleibend s", 0),
		strState(IMMERSION_RUNTIME_STATES.lastSwitchAt, "Letzter Schaltzeitpunkt (ISO)"),
		boolState(IMMERSION_RUNTIME_STATES.faultActive, "Fault aktiv", false),
		strState(IMMERSION_RUNTIME_STATES.faultCode, "Fault-Code", "none"),
		strState(IMMERSION_RUNTIME_STATES.faultSince, "Fault seit (ISO)"),
		strState(IMMERSION_RUNTIME_STATES.faultMessage, "Fault-Meldung", ""),
		boolState(IMMERSION_RUNTIME_STATES.faultReset, "Fault Reset", false, true),
		strState(IMMERSION_RUNTIME_STATES.reason, "Runtime-Grund", ""),
		strState(IMMERSION_RUNTIME_STATES.snapshotJson, "Runtime Snapshot (JSON)", "{}"),
	];
	await ensureStates(host, defs);
}

export { MODE_STATES };
