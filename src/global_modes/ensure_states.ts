import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../ems_light/state_util";
import { GLOBAL_MODES } from "./constants";

const GLOBAL_MODE_STATE_LABELS: Record<string, string> = {
	off: "Off (Optimierung aus)",
	eco: "Eco",
	balanced: "Balanced (Standard)",
	comfort: "Comfort",
	forced: "Forced",
};

const GLOBAL_MODE_STATES: Record<string, string> = Object.fromEntries(
	GLOBAL_MODES.map((m) => [m, GLOBAL_MODE_STATE_LABELS[m] ?? m]),
);

function strState(
	id: string,
	name: string,
	def?: string,
	write = false,
	states?: Record<string, string>,
): StateDef {
	const common: ioBroker.StateCommon = {
		name,
		type: "string",
		role: states ? "value" : "text",
		read: !write,
		write,
		def,
	};
	if (states) {
		common.states = states;
	}
	return {
		id,
		common,
		defaultVal: def,
		setDefaultIfEmpty: !write,
		extendCommon: states ? true : undefined,
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

export const GLOBAL_MODES_CHANNEL = "global_modes";

export async function ensureGlobalModesChannels(host: StateHost): Promise<void> {
	await ensureChannel(host, GLOBAL_MODES_CHANNEL, "EMS-Light Global Modes");
}

export async function ensureGlobalModesStates(host: StateHost, adminDefault: string): Promise<void> {
	await ensureGlobalModesChannels(host);

	const defs: StateDef[] = [
		strState("global_modes.requested", "Global Mode (Benutzerwunsch)", adminDefault, true, GLOBAL_MODE_STATES),
		strState("global_modes.admin_default", "Global Mode Admin-Default (zuletzt gesehen)"),
		strState("global_modes.active", "Global Mode aktiv", adminDefault),
		strState("global_modes.available_json", "Global Modes verfügbar (JSON)", "[]"),
		strState("global_modes.effective_profile_json", "Global Mode Profil (JSON)", "{}"),
		strState("global_modes.status", "Global Modes Status", "not_initialized"),
		boolState("global_modes.valid", "Global Modes gültig", false),
		strState("global_modes.issues_json", "Global Modes Issues (JSON)", "[]"),
		strState("global_modes.revision", "Global Modes Revision", ""),
		strState("global_modes.updated_at", "Global Modes aktualisiert (ISO)", ""),
	];

	await ensureStates(host, defs);
}
