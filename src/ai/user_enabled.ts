import { asBool } from "../ems_light/state_util";
import { AI_STATES } from "./ensure_states";

/**
 * Runtime-Bedienzustand „KI benutzen“ (v0.1.258).
 * Single source of truth nach einmaliger Migration von native.ai_enabled.
 * Kein Adapter-Restart beim Toggle. AI_ALLOCATION_LIVE_MUTATION_ENABLED bleibt false.
 */

export type AiUserEnabledHost = {
	config: unknown;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	log?: { info?: (m: string) => void; warn?: (m: string) => void; debug?: (m: string) => void };
};

/** Enable-Epoch: jeder Toggle invalidiert laufende Requests (Publish-Guard). */
let aiEnableEpoch = 0;

export function currentAiEnableEpoch(): number {
	return aiEnableEpoch;
}

export function bumpAiEnableEpoch(): number {
	aiEnableEpoch += 1;
	return aiEnableEpoch;
}

export function resetAiEnableEpochForTest(): void {
	aiEnableEpoch = 0;
}

export async function readAiUserEnabled(host: AiUserEnabledHost): Promise<boolean> {
	const st = await host.getStateAsync(AI_STATES.userEnabled);
	return st?.val === true;
}

/**
 * Publish nur wenn Nutzer weiterhin EIN will und die Request-Epoch unverändert ist.
 * OFF → ON während alter Request: Epoch hat sich zweimal geändert → alter Request bleibt ungültig.
 */
export async function isAiPublishAllowed(
	host: AiUserEnabledHost,
	requestEpoch: number,
): Promise<boolean> {
	if (requestEpoch !== currentAiEnableEpoch()) return false;
	return readAiUserEnabled(host);
}

/**
 * Einmalige Migration native.ai_enabled → ai.user_enabled.
 * Markierung ai.user_enabled_migrated_v1 verhindert erneutes Seed nach State-Löschung.
 */
export async function migrateAiUserEnabledOnce(
	host: AiUserEnabledHost,
): Promise<{ ran: boolean; userEnabled: boolean }> {
	const migratedSt = await host.getStateAsync(AI_STATES.userEnabledMigratedV1);
	if (migratedSt?.val === true) {
		const enabled = await readAiUserEnabled(host);
		return { ran: false, userEnabled: enabled };
	}

	const c = host.config && typeof host.config === "object" ? (host.config as Record<string, unknown>) : {};
	const fromNative = asBool(c.ai_enabled) ?? false;
	await host.setStateAsync(AI_STATES.userEnabled, { val: fromNative, ack: true });
	await host.setStateAsync(AI_STATES.userEnabledMigratedV1, { val: true, ack: true });
	if (!fromNative) {
		await host.setStateAsync(AI_STATES.status, { val: "off", ack: true });
	}
	host.log?.info?.(
		`ai: migrated native.ai_enabled=${fromNative} → ai.user_enabled (once, migrated_v1)`,
	);
	return { ran: true, userEnabled: fromNative };
}

/** Runtime-Toggle: ack schreiben, Epoch bumpen, bei OFF Status sofort „off“. */
export async function applyAiUserEnabledToggle(
	host: AiUserEnabledHost,
	enabled: boolean,
): Promise<void> {
	bumpAiEnableEpoch();
	await host.setStateAsync(AI_STATES.userEnabled, { val: enabled, ack: true });
	if (!enabled) {
		await host.setStateAsync(AI_STATES.status, { val: "off", ack: true });
	}
	host.log?.info?.(`ai: user_enabled → ${enabled} (epoch=${currentAiEnableEpoch()}, no restart)`);
}
