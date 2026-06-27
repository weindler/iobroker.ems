import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";
import { INTENT_CONTRACT_VERSION } from "./core/constants";

function strState(
	id: string,
	name: string,
	def?: string,
	write = false,
	extendCommon?: boolean,
): StateDef {
	return {
		id,
		common: {
			name,
			type: "string",
			role: "text",
			read: !write,
			write,
			def,
		},
		defaultVal: def,
		setDefaultIfEmpty: !write,
		extendCommon,
	};
}

function numState(id: string, name: string, def?: number): StateDef {
	return {
		id,
		common: {
			name,
			type: "number",
			role: "value",
			read: true,
			write: false,
			def,
		},
		defaultVal: def,
	};
}

function boolState(id: string, name: string, def?: boolean): StateDef {
	return {
		id,
		common: {
			name,
			type: "boolean",
			role: "switch",
			read: true,
			write: false,
			def,
		},
		defaultVal: def,
	};
}

function domainMirrorStates(prefix: string, label: string): StateDef[] {
	return [
		strState(`${prefix}.resolved_json`, `${label} Intent (aufgelöst, JSON)`, "{}"),
		numState(`${prefix}.revision`, `${label} Intent Revision`, 0),
		strState(`${prefix}.intent_state`, `${label} Intent State`, "none"),
		strState(`${prefix}.last_changed`, `${label} Intent zuletzt geändert (ISO)`, ""),
		boolState(`${prefix}.manual_override_active`, `${label} Manual Override aktiv`, false),
		strState(`${prefix}.source_summary`, `${label} Intent Quellen (JSON)`, "[]"),
		strState(`${prefix}.diagnostics.last_error`, `${label} Intent letzter Fehler`, ""),
	];
}

function domainRequestStates(prefix: string, label: string): StateDef[] {
	return [
		strState(`${prefix}.request_json`, `${label} Intent Request (JSON)`, "", true),
		strState(`${prefix}.result_json`, `${label} Intent Request Ergebnis (JSON)`, "{}"),
	];
}

export const USER_INTENT_CHANNEL = "user_intent";
export const USER_INTENT_WALLBOX_CHANNEL = "user_intent.wallbox";
export const USER_INTENT_THERMAL_CHANNEL = "user_intent.thermal";
export const USER_INTENT_BATTERY_CHANNEL = "user_intent.battery";
export const USER_INTENT_INPUTS_CHANNEL = "user_intent.inputs";
export const USER_INTENT_IOBROKER_CHANNEL = "user_intent.inputs.iobroker";
export const USER_INTENT_WALLBOX_INPUTS_CHANNEL = "user_intent.inputs.iobroker.wallbox";
export const USER_INTENT_THERMAL_INPUTS_CHANNEL = "user_intent.inputs.iobroker.thermal";
export const USER_INTENT_BATTERY_INPUTS_CHANNEL = "user_intent.inputs.iobroker.battery";
export const USER_INTENT_WALLBOX_SOURCES_CHANNEL = "user_intent.wallbox.sources";
export const USER_INTENT_WALLBOX_DIAG_CHANNEL = "user_intent.wallbox.diagnostics";

export async function ensureIntentChannels(host: StateHost): Promise<void> {
	await ensureChannel(host, USER_INTENT_CHANNEL, "EMS-Light User Intent");
	await ensureChannel(host, USER_INTENT_WALLBOX_CHANNEL, "EMS-Light Wallbox Intent");
	await ensureChannel(host, USER_INTENT_THERMAL_CHANNEL, "EMS-Light Thermal Intent");
	await ensureChannel(host, USER_INTENT_BATTERY_CHANNEL, "EMS-Light Battery Intent");
	await ensureChannel(host, USER_INTENT_INPUTS_CHANNEL, "EMS-Light Intent Inputs");
	await ensureChannel(host, USER_INTENT_IOBROKER_CHANNEL, "EMS-Light ioBroker Intent Input");
	await ensureChannel(host, USER_INTENT_WALLBOX_INPUTS_CHANNEL, "EMS-Light Wallbox ioBroker Input");
	await ensureChannel(host, USER_INTENT_THERMAL_INPUTS_CHANNEL, "EMS-Light Thermal ioBroker Input");
	await ensureChannel(host, USER_INTENT_BATTERY_INPUTS_CHANNEL, "EMS-Light Battery ioBroker Input");
	await ensureChannel(host, USER_INTENT_WALLBOX_SOURCES_CHANNEL, "EMS-Light Wallbox Intent Sources");
	await ensureChannel(host, USER_INTENT_WALLBOX_DIAG_CHANNEL, "EMS-Light Wallbox Intent Diagnostics");
	await ensureChannel(host, "user_intent.wallbox.sources.evcc", "EMS-Light EVCC Intent Source");
	await ensureChannel(host, "user_intent.wallbox.sources.admin", "EMS-Light Admin Intent Defaults");
	await ensureChannel(host, "user_intent.thermal.diagnostics", "EMS-Light Thermal Intent Diagnostics");
	await ensureChannel(host, "user_intent.battery.diagnostics", "EMS-Light Battery Intent Diagnostics");
}

export async function ensureIntentStates(host: StateHost): Promise<void> {
	await ensureIntentChannels(host);

	const defs: StateDef[] = [
		strState("user_intent.contract_version", "User Intent Contract Version", INTENT_CONTRACT_VERSION, false, true),
		strState("user_intent.status", "User Intent Engine Status", "not_initialized"),
		strState("user_intent.resolved_all_json", "User Intent Gesamtvertrag (JSON)", "{}"),
		numState("user_intent.resolved_all.revision", "User Intent Gesamt-Revision", 0),
		...domainMirrorStates("user_intent.wallbox", "Wallbox"),
		strState("user_intent.wallbox.diagnostics.last_resolution_json", "Wallbox Intent letzte Auflösung (JSON)", "{}"),
		strState("user_intent.wallbox.sources.evcc.snapshot_json", "EVCC Intent Snapshot (JSON)", "{}"),
		strState("user_intent.wallbox.sources.evcc.status", "EVCC Intent Source Status", "unconfigured"),
		strState("user_intent.wallbox.sources.evcc.last_observed", "EVCC Intent zuletzt beobachtet (ISO)", ""),
		strState("user_intent.wallbox.sources.admin.snapshot_json", "Admin Intent Defaults (JSON)", "{}"),
		...domainMirrorStates("user_intent.thermal", "Thermal"),
		...domainMirrorStates("user_intent.battery", "Battery"),
		...domainRequestStates("user_intent.inputs.iobroker.wallbox", "Wallbox"),
		...domainRequestStates("user_intent.inputs.iobroker.thermal", "Thermal"),
		...domainRequestStates("user_intent.inputs.iobroker.battery", "Battery"),
	];

	await ensureStates(host, defs);
}
