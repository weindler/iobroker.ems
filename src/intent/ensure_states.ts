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

export const USER_INTENT_CHANNEL = "user_intent";
export const USER_INTENT_WALLBOX_CHANNEL = "user_intent.wallbox";
export const USER_INTENT_INPUTS_CHANNEL = "user_intent.inputs";
export const USER_INTENT_IOBROKER_CHANNEL = "user_intent.inputs.iobroker";
export const USER_INTENT_WALLBOX_INPUTS_CHANNEL = "user_intent.inputs.iobroker.wallbox";
export const USER_INTENT_WALLBOX_SOURCES_CHANNEL = "user_intent.wallbox.sources";
export const USER_INTENT_WALLBOX_DIAG_CHANNEL = "user_intent.wallbox.diagnostics";

export async function ensureIntentChannels(host: StateHost): Promise<void> {
	await ensureChannel(host, USER_INTENT_CHANNEL, "EMS-Light User Intent");
	await ensureChannel(host, USER_INTENT_WALLBOX_CHANNEL, "EMS-Light Wallbox Intent");
	await ensureChannel(host, USER_INTENT_INPUTS_CHANNEL, "EMS-Light Intent Inputs");
	await ensureChannel(host, USER_INTENT_IOBROKER_CHANNEL, "EMS-Light ioBroker Intent Input");
	await ensureChannel(host, USER_INTENT_WALLBOX_INPUTS_CHANNEL, "EMS-Light Wallbox ioBroker Input");
	await ensureChannel(host, USER_INTENT_WALLBOX_SOURCES_CHANNEL, "EMS-Light Wallbox Intent Sources");
	await ensureChannel(host, USER_INTENT_WALLBOX_DIAG_CHANNEL, "EMS-Light Wallbox Intent Diagnostics");
	await ensureChannel(host, "user_intent.wallbox.sources.evcc", "EMS-Light EVCC Intent Source");
	await ensureChannel(host, "user_intent.wallbox.sources.admin", "EMS-Light Admin Intent Defaults");
}

export async function ensureIntentStates(host: StateHost): Promise<void> {
	await ensureIntentChannels(host);

	const defs: StateDef[] = [
		strState("user_intent.contract_version", "User Intent Contract Version", INTENT_CONTRACT_VERSION, false, true),
		strState("user_intent.status", "User Intent Engine Status", "not_initialized"),
		strState("user_intent.wallbox.resolved_json", "Wallbox Intent (aufgelöst, JSON)", "{}"),
		numState("user_intent.wallbox.revision", "Wallbox Intent Revision", 0),
		strState("user_intent.wallbox.intent_state", "Wallbox Intent State", "none"),
		strState("user_intent.wallbox.last_changed", "Wallbox Intent zuletzt geändert (ISO)", ""),
		boolState("user_intent.wallbox.manual_override_active", "Wallbox Manual Override aktiv", false),
		strState("user_intent.wallbox.source_summary", "Wallbox Intent Quellen (JSON)", "[]"),
		strState("user_intent.wallbox.sources.evcc.snapshot_json", "EVCC Intent Snapshot (JSON)", "{}"),
		strState("user_intent.wallbox.sources.evcc.status", "EVCC Intent Source Status", "unconfigured"),
		strState("user_intent.wallbox.sources.evcc.last_observed", "EVCC Intent zuletzt beobachtet (ISO)", ""),
		strState("user_intent.wallbox.sources.admin.snapshot_json", "Admin Intent Defaults (JSON)", "{}"),
		strState("user_intent.inputs.iobroker.wallbox.request_json", "Wallbox Intent Request (JSON)", "", true),
		strState("user_intent.inputs.iobroker.wallbox.result_json", "Wallbox Intent Request Ergebnis (JSON)", "{}"),
		strState("user_intent.wallbox.diagnostics.last_error", "Wallbox Intent letzter Fehler", ""),
		strState("user_intent.wallbox.diagnostics.last_resolution_json", "Wallbox Intent letzte Auflösung (JSON)", "{}"),
	];

	await ensureStates(host, defs);
}
