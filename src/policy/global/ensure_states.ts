import { ensureChannel, ensureStates, type StateDef, type StateHost } from "../../ems_light/state_util";

function strState(id: string, name: string, def?: string): StateDef {
	return {
		id,
		common: { name, type: "string", role: "text", read: true, write: false, def },
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

export async function ensurePolicyChannels(host: StateHost): Promise<void> {
	await ensureChannel(host, "policy", "EMS-Light Policy");
	await ensureChannel(host, "policy.system", "EMS-Light Policy System");
	await ensureChannel(host, "policy.global", "EMS-Light Policy Global");
}

export async function ensureSystemPolicyStates(host: StateHost): Promise<void> {
	await ensurePolicyChannels(host);
	const defs: StateDef[] = [
		strState("policy.system.schema_version", "Policy Schema-Version"),
		strState("policy.system.engine_version", "Policy Engine-Version"),
		strState("policy.system.status", "Policy Engine Status", "not_initialized"),
		boolState("policy.system.valid", "Policy Engine gültig", false),
		strState("policy.system.issues_json", "Policy Engine Issues (JSON)", "[]"),
		strState("policy.system.registered_providers_json", "Policy Provider Registry (JSON)", "[]"),
		strState("policy.system.revision", "Policy Engine Revision", ""),
		strState("policy.system.updated_at", "Policy Engine aktualisiert (ISO)", ""),
	];
	await ensureStates(host, defs);
}

export async function ensureGlobalPolicyStates(host: StateHost): Promise<void> {
	await ensurePolicyChannels(host);
	const defs: StateDef[] = [
		strState("policy.global.configured_json", "Globale Policy konfiguriert (JSON)", "{}"),
		strState("policy.global.effective_json", "Globale Policy effektiv (JSON)", "{}"),
		strState("policy.global.provenance_json", "Globale Policy Herkunft (JSON)", "{}"),
		strState("policy.global.status", "Globale Policy Status", "not_initialized"),
		boolState("policy.global.valid", "Globale Policy gültig", false),
		strState("policy.global.issues_json", "Globale Policy Issues (JSON)", "[]"),
		strState("policy.global.revision", "Globale Policy Revision", ""),
		strState("policy.global.updated_at", "Globale Policy aktualisiert (ISO)", ""),
	];
	await ensureStates(host, defs);
}

/** Vorbereitung Phase 3B — States für Add-on-Instanzen */
export async function ensureAddonPolicyStates(
	host: StateHost,
	addonType: string,
	instanceId: string,
): Promise<void> {
	const base = `policy.${addonType}.${instanceId}`;
	await ensureChannel(host, `policy.${addonType}`, `EMS-Light Policy ${addonType}`);
	await ensureChannel(host, base, `EMS-Light Policy ${addonType} ${instanceId}`);
	const defs: StateDef[] = [
		strState(`${base}.configured_json`, `${addonType} Policy konfiguriert (JSON)`, "{}"),
		strState(`${base}.effective_json`, `${addonType} Policy effektiv (JSON)`, "{}"),
		strState(`${base}.provenance_json`, `${addonType} Policy Herkunft (JSON)`, "{}"),
		strState(`${base}.status`, `${addonType} Policy Status`, "not_initialized"),
		boolState(`${base}.valid`, `${addonType} Policy gültig`, false),
		strState(`${base}.issues_json`, `${addonType} Policy Issues (JSON)`, "[]"),
		strState(`${base}.revision`, `${addonType} Policy Revision`, "{}"),
		strState(`${base}.updated_at`, `${addonType} Policy aktualisiert (ISO)`, ""),
	];
	await ensureStates(host, defs);
}
