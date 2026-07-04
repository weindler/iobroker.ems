import { GLOBAL, addonMode } from "./tree_paths";

export type ExecutionMode = "dryrun" | "live";

export const EXECUTION_MODES = ["dryrun", "live"] as const;

export const EXECUTION_MODE_STATE_LABELS: Record<ExecutionMode, string> = {
	dryrun: "Dryrun (kein Schreiben)",
	live: "Live (Schreiben erlaubt)",
};

export const EXECUTION_MODE_STATES: Record<string, string> = {
	dryrun: EXECUTION_MODE_STATE_LABELS.dryrun,
	live: EXECUTION_MODE_STATE_LABELS.live,
};

/** Addons mit dryrun/live-Schalter (Admin + Objektbaum). */
export const EXECUTION_MODE_ADDON_IDS = ["wallbox", "battery", "immersion_heater"] as const;

export type ExecutionModeAddonId = (typeof EXECUTION_MODE_ADDON_IDS)[number];

const ADDON_EXECUTION_MODE_NAMES: Record<ExecutionModeAddonId, string> = {
	wallbox: "Wallbox: Ausführung (dryrun|live)",
	battery: "Batterie: Ausführung (dryrun|live)",
	immersion_heater: "Heizstab: Ausführung (dryrun|live)",
};

export interface ExecutionModeHost {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	extendObjectAsync?: (id: string, obj: Partial<ioBroker.Object>) => Promise<unknown>;
}

/** Interner Fingerabdruck der zuletzt synchronisierten Admin-Config (nicht manuell setzen). */
export const EXECUTION_MODE_CONFIG_FINGERPRINT = "global.execution_mode_config_fingerprint";

export interface ExecutionModeConfigModes {
	global: ExecutionMode;
	wallbox: ExecutionMode;
	battery: ExecutionMode;
	immersion_heater: ExecutionMode;
}

export function executionModesFromConfig(config: Record<string, unknown>): ExecutionModeConfigModes {
	const c = config as GlobalExecutionConfig;
	return {
		global: parseMode(c.global_execution_mode ?? "dryrun"),
		wallbox: parseMode(c.wb_addon_mode ?? "dryrun"),
		battery: parseMode(c.bat_addon_mode ?? "dryrun"),
		immersion_heater: parseMode(c.ih_addon_mode ?? "dryrun"),
	};
}

export function executionModesConfigFingerprint(config: Record<string, unknown>): string {
	return JSON.stringify(executionModesFromConfig(config));
}

export interface GlobalExecutionConfig {
	global_execution_mode?: string;
	wb_addon_mode?: string;
	bat_addon_mode?: string;
	ih_addon_mode?: string;
}

export function parseMode(raw: unknown): ExecutionMode {
	return String(raw ?? "dryrun").toLowerCase() === "live" ? "live" : "dryrun";
}

export function executionModeCommon(name: string, def: ExecutionMode = "dryrun"): ioBroker.StateCommon {
	return {
		name,
		type: "string",
		role: "value",
		read: true,
		write: true,
		def,
		states: EXECUTION_MODE_STATES,
	};
}

export async function isLiveWriteAllowed(
	getState: (id: string) => Promise<ioBroker.State | null | undefined>,
	addonId: string,
): Promise<boolean> {
	const global = await getState(GLOBAL.executionMode);
	if (parseMode(global?.val) !== "live") {
		return false;
	}
	const addon = await getState(addonMode(addonId));
	return parseMode(addon?.val) === "live";
}

async function ensureExecutionModeObject(
	host: ExecutionModeHost,
	id: string,
	common: ioBroker.StateCommon,
): Promise<void> {
	await host.setObjectNotExistsAsync(id, {
		type: "state",
		common,
		native: {},
	} as ioBroker.Object);
	if (host.extendObjectAsync) {
		await host.extendObjectAsync(id, { common });
	}
}

function hasExecutionModeValue(val: unknown): boolean {
	const s = String(val ?? "").trim().toLowerCase();
	return s === "dryrun" || s === "live";
}

async function applyExecutionModesFromConfig(
	host: ExecutionModeHost,
	modes: ExecutionModeConfigModes,
): Promise<void> {
	await host.setStateAsync(GLOBAL.executionMode, { val: modes.global, ack: true });
	await host.setStateAsync(addonMode("wallbox"), { val: modes.wallbox, ack: true });
	await host.setStateAsync(addonMode("battery"), { val: modes.battery, ack: true });
	await host.setStateAsync(addonMode("immersion_heater"), { val: modes.immersion_heater, ack: true });
}

async function anyExecutionModeEmpty(host: ExecutionModeHost): Promise<boolean> {
	const ids = [
		GLOBAL.executionMode,
		...EXECUTION_MODE_ADDON_IDS.map((addonId) => addonMode(addonId)),
	];
	for (const id of ids) {
		const cur = await host.getStateAsync(id);
		if (!hasExecutionModeValue(cur?.val)) {
			return true;
		}
	}
	return false;
}

async function mirrorGlobalExecutionSafety(host: ExecutionModeHost): Promise<void> {
	const global = await host.getStateAsync(GLOBAL.executionMode);
	await host.setStateAsync("execution.safety.global_execution_mode", {
		val: parseMode(global?.val),
		ack: true,
	});
}

export async function ensureGlobalExecutionStates(host: ExecutionModeHost): Promise<void> {
	await ensureExecutionModeObject(
		host,
		GLOBAL.executionMode,
		executionModeCommon("Global: Ausführung (dryrun|live)"),
	);
	await ensureExecutionModeObject(host, EXECUTION_MODE_CONFIG_FINGERPRINT, {
		name: "Intern: Admin-Fingerprint Ausführungsmodi",
		type: "string",
		role: "text",
		read: true,
		write: false,
	});
}

export async function ensureAddonExecutionModeStates(host: ExecutionModeHost): Promise<void> {
	for (const addonId of EXECUTION_MODE_ADDON_IDS) {
		await ensureExecutionModeObject(
			host,
			addonMode(addonId),
			executionModeCommon(ADDON_EXECUTION_MODE_NAMES[addonId]),
		);
	}
}

/**
 * Admin-Config ↔ Objektbaum:
 * - Admin geändert + Speichern → Config wird auf States geschrieben
 * - Neustart ohne Admin-Änderung → Laufzeitwerte aus Objektbaum bleiben
 * - Erststart / leere States → Admin-Defaults
 */
export async function syncExecutionModesFromConfig(
	host: ExecutionModeHost & { log?: { info?: (msg: string) => void } },
	config: Record<string, unknown>,
): Promise<void> {
	const modes = executionModesFromConfig(config);
	const fingerprint = executionModesConfigFingerprint(config);
	const prevRaw = await host.getStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT);
	const prevFingerprint = String(prevRaw?.val ?? "");
	const empty = await anyExecutionModeEmpty(host);

	if (!prevFingerprint && !empty) {
		// Upgrade: Laufzeitwerte schon gesetzt, Fingerabdruck fehlt — nicht überschreiben
		await host.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, { val: fingerprint, ack: true });
		await mirrorGlobalExecutionSafety(host);
		host.log?.info?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin-Fingerprint initialisiert)");
		return;
	}

	if (empty || fingerprint !== prevFingerprint) {
		await applyExecutionModesFromConfig(host, modes);
		await host.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, { val: fingerprint, ack: true });
		host.log?.info?.(
			empty
				? "Ausführungsmodi aus Admin übernommen (Erststart)"
				: "Ausführungsmodi aus Admin übernommen (Config geändert)",
		);
	} else {
		host.log?.info?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin unverändert)");
	}

	await mirrorGlobalExecutionSafety(host);
}

export function isExecutionModeStateRelativeId(relativeId: string): boolean {
	if (relativeId === GLOBAL.executionMode) {
		return true;
	}
	return EXECUTION_MODE_ADDON_IDS.some((addonId) => relativeId === addonMode(addonId));
}

export async function handleExecutionModeStateChange(
	adapter: ExecutionModeHost & {
		namespace: string;
		log: { info: (msg: string) => void; warn?: (msg: string) => void };
	},
	id: string,
	state: ioBroker.State | null,
): Promise<void> {
	if (!state || state.ack) {
		return;
	}
	const prefix = `${adapter.namespace}.`;
	if (!id.startsWith(prefix)) {
		return;
	}
	const relativeId = id.slice(prefix.length);
	if (!isExecutionModeStateRelativeId(relativeId)) {
		return;
	}

	const requested = String(state.val ?? "").trim().toLowerCase();
	const mode = parseMode(state.val);
	if (requested !== "" && requested !== "dryrun" && requested !== "live") {
		adapter.log.warn?.(
			`${relativeId}: ungültiger Wert „${state.val}“ — Fallback auf ${mode}`,
		);
	}

	await adapter.setStateAsync(relativeId, { val: mode, ack: true });
	if (relativeId === GLOBAL.executionMode) {
		await adapter.setStateAsync("execution.safety.global_execution_mode", { val: mode, ack: true });
	}
	adapter.log.info(`${relativeId} → ${mode} (Objektbaum)`);
}

export async function ensureChannelTree(
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>,
): Promise<void> {
	const channels: Array<{ id: string; name: string }> = [
		{ id: "global", name: "Global" },
		{ id: "ems_mirror", name: "EMS Spiegel (read/write von EMS)" },
		{ id: "command", name: "Befehle (Inbox)" },
		{ id: "audit", name: "Audit" },
		{ id: "addons", name: "Addons" },
		{ id: "addons.wallbox", name: "Wallbox" },
		{ id: "addons.battery", name: "Batterie" },
		{ id: "addons.immersion_heater", name: "Heizstab" },
		{ id: "addons.dynamic_tariff", name: "Dynamischer Tarif" },
	];
	for (const ch of channels) {
		await setObjectNotExistsAsync(ch.id, {
			type: "channel",
			common: { name: ch.name },
			native: {},
		} as ioBroker.Object);
	}
}
