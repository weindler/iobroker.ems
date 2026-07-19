import { isStartupRearmRequired, clearStartupRearmRequired, getBootstrapCompletedAtMs, isExplicitUserLiveRearmRequest } from "./backup_integration/startup_rearm";
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
export const EXECUTION_MODE_ADDON_IDS = ["wallbox", "battery", "immersion_heater", "air_conditioning"] as const;

export type ExecutionModeAddonId = (typeof EXECUTION_MODE_ADDON_IDS)[number];

const ADDON_EXECUTION_MODE_NAMES: Record<ExecutionModeAddonId, string> = {
	wallbox: "Wallbox: Ausführung (dryrun|live)",
	battery: "Batterie: Ausführung (dryrun|live)",
	immersion_heater: "Heizstab: Ausführung (dryrun|live)",
	air_conditioning: "Klima: Ausführung (dryrun|live)",
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
	air_conditioning: ExecutionMode;
}

export function executionModesFromConfig(config: Record<string, unknown>): ExecutionModeConfigModes {
	const c = config as GlobalExecutionConfig;
	return {
		global: parseMode(c.global_execution_mode ?? "dryrun"),
		wallbox: parseMode(c.wb_addon_mode ?? "dryrun"),
		battery: parseMode(c.bat_addon_mode ?? "dryrun"),
		immersion_heater: parseMode(c.ih_addon_mode ?? "dryrun"),
		air_conditioning: parseMode(c.ac_addon_mode ?? "dryrun"),
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
	ac_addon_mode?: string;
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
	if (isStartupRearmRequired()) {
		return false;
	}
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

const ALL_DRYRUN_MODES: ExecutionModeConfigModes = {
	global: "dryrun",
	wallbox: "dryrun",
	battery: "dryrun",
	immersion_heater: "dryrun",
	air_conditioning: "dryrun",
};

export interface SyncExecutionModesOptions {
	/** @deprecated Nutze forceDryrunReason */
	coldStartRecovery?: boolean;
	/** Erzwingt Dryrun-States unabhängig von Admin-Config und Namespace-Erkennung. */
	forceDryrunReason?: ForceDryrunReason | null;
}

export type ForceDryrunReason = "namespace_cold_start" | "restore_recovery" | "startup_rearm_required";

export const NATIVE_EXECUTION_MODE_KEYS = [
	"global_execution_mode",
	"wb_addon_mode",
	"bat_addon_mode",
	"ih_addon_mode",
	"ac_addon_mode",
] as const;

/** Setzt Native-Ausführungsmodi auf dryrun — übrige Native-Felder unverändert. */
export function clampNativeExecutionModesDryrun(config: Record<string, unknown>): Record<string, unknown> {
	return {
		...config,
		global_execution_mode: "dryrun",
		wb_addon_mode: "dryrun",
		bat_addon_mode: "dryrun",
		ih_addon_mode: "dryrun",
		ac_addon_mode: "dryrun",
	};
}

async function applyExecutionModesFromConfig(
	host: ExecutionModeHost,
	modes: ExecutionModeConfigModes,
): Promise<void> {
	await host.setStateAsync(GLOBAL.executionMode, { val: modes.global, ack: true });
	await host.setStateAsync(addonMode("wallbox"), { val: modes.wallbox, ack: true });
	await host.setStateAsync(addonMode("battery"), { val: modes.battery, ack: true });
	await host.setStateAsync(addonMode("immersion_heater"), { val: modes.immersion_heater, ack: true });
	await host.setStateAsync(addonMode("air_conditioning"), { val: modes.air_conditioning, ack: true });
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

async function alignAdminConfigWithRuntimeStates(
	host: ExecutionModeHost & {
		config?: unknown;
		updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
		log?: { info?: (msg: string) => void; debug?: (msg: string) => void };
	},
	config: Record<string, unknown>,
): Promise<void> {
	if (typeof host.updateConfig !== "function") {
		return;
	}
	const base =
		host.config && typeof host.config === "object"
			? ({ ...(host.config as Record<string, unknown>) } as Record<string, unknown>)
			: { ...config };
	let changed = false;
	const pairs: Array<[string, keyof GlobalExecutionConfig]> = [
		[GLOBAL.executionMode, "global_execution_mode"],
		[addonMode("wallbox"), "wb_addon_mode"],
		[addonMode("battery"), "bat_addon_mode"],
		[addonMode("immersion_heater"), "ih_addon_mode"],
		[addonMode("air_conditioning"), "ac_addon_mode"],
	];
	for (const [stateId, configKey] of pairs) {
		const st = await host.getStateAsync(stateId);
		if (!st || !hasExecutionModeValue(st.val)) {
			continue;
		}
		const mode = parseMode(st.val);
		if (parseMode(base[configKey]) !== mode) {
			base[configKey] = mode;
			changed = true;
		}
	}
	if (!changed) {
		return;
	}
	await host.updateConfig(base);
	await host.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, {
		val: executionModesConfigFingerprint(base),
		ack: true,
	});
	host.log?.debug?.("Ausführungsmodi: Admin-Config an Objektbaum angeglichen");
}

/**
 * Admin-Config ↔ Objektbaum:
 * - Admin geändert + Speichern → Config wird auf States geschrieben
 * - Neustart ohne Admin-Änderung → Laufzeitwerte aus Objektbaum bleiben, Admin wird nachgezogen
 * - Erststart / leere States → Admin-Defaults
 */
export async function syncExecutionModesFromConfig(
	host: ExecutionModeHost & {
		log?: { info?: (msg: string) => void; debug?: (msg: string) => void };
		config?: unknown;
		updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
	},
	config: Record<string, unknown>,
	options: SyncExecutionModesOptions = {},
): Promise<void> {
	const modes = executionModesFromConfig(config);
	const fingerprint = executionModesConfigFingerprint(config);
	const prevRaw = await host.getStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT);
	const prevFingerprint = String(prevRaw?.val ?? "");
	const empty = await anyExecutionModeEmpty(host);

	const forceReason =
		options.forceDryrunReason ??
		(options.coldStartRecovery ? ("namespace_cold_start" as ForceDryrunReason) : null);

	if (forceReason) {
		const dryrunNative =
			forceReason === "restore_recovery" ? clampNativeExecutionModesDryrun(config) : config;
		if (forceReason === "restore_recovery" && typeof host.updateConfig === "function") {
			await host.updateConfig(dryrunNative);
		}
		if (forceReason === "startup_rearm_required") {
			// Object tree follows Admin/Native; writes stay gated by isStartupRearmRequired().
			await applyExecutionModesFromConfig(host, modes);
			await host.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, {
				val: fingerprint,
				ack: true,
			});
			await mirrorGlobalExecutionSafety(host);
			host.log?.info?.(
				"Startup-Rearm: Objektbaum folgt Admin-Config — Geräte-Writes gesperrt bis explizitem Live-Rearm",
			);
			return;
		}
		await applyExecutionModesFromConfig(host, ALL_DRYRUN_MODES);
		await host.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, {
			val: executionModesConfigFingerprint(dryrunNative),
			ack: true,
		});
		await mirrorGlobalExecutionSafety(host);
		if (forceReason === "restore_recovery") {
			host.log?.info?.(
				"Restore-Recovery: Ausführungsmodi in Native und Objektbaum auf dryrun gesetzt",
			);
		} else {
			host.log?.info?.(
				"Cold-Start-Recovery: Ausführungsmodi auf dryrun geklemmt (Admin-Konfiguration unverändert)",
			);
		}
		return;
	}

	if (!prevFingerprint && !empty) {
		// Upgrade: Laufzeitwerte schon gesetzt, Fingerabdruck fehlt — nicht überschreiben
		await host.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, { val: fingerprint, ack: true });
		await alignAdminConfigWithRuntimeStates(host, config);
		await mirrorGlobalExecutionSafety(host);
		host.log?.debug?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin-Fingerprint initialisiert)");
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
		host.log?.debug?.("Ausführungsmodi: Laufzeitwerte beibehalten (Admin unverändert)");
		await alignAdminConfigWithRuntimeStates(host, config);
	}

	await mirrorGlobalExecutionSafety(host);
}

export function executionModeConfigKeyForRelativeId(relativeId: string): keyof GlobalExecutionConfig | null {
	switch (relativeId) {
		case GLOBAL.executionMode:
			return "global_execution_mode";
		case addonMode("wallbox"):
			return "wb_addon_mode";
		case addonMode("battery"):
			return "bat_addon_mode";
		case addonMode("immersion_heater"):
			return "ih_addon_mode";
		case addonMode("air_conditioning"):
			return "ac_addon_mode";
		default:
			return null;
	}
}

export async function persistExecutionModeToAdminConfig(
	adapter: ExecutionModeHost & {
		config?: unknown;
		updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
	},
	relativeId: string,
	mode: ExecutionMode,
): Promise<boolean> {
	const configKey = executionModeConfigKeyForRelativeId(relativeId);
	if (!configKey || typeof adapter.updateConfig !== "function") {
		return false;
	}
	const base =
		adapter.config && typeof adapter.config === "object"
			? ({ ...(adapter.config as Record<string, unknown>) } as Record<string, unknown>)
			: {};
	if (parseMode(base[configKey]) === mode) {
		await adapter.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, {
			val: executionModesConfigFingerprint(base),
			ack: true,
		});
		return false;
	}
	base[configKey] = mode;
	await adapter.updateConfig(base);
	await adapter.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, {
		val: executionModesConfigFingerprint(base),
		ack: true,
	});
	return true;
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
		config?: unknown;
		updateConfig?: (newConfig: Record<string, unknown>) => Promise<unknown>;
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

	if (
		isStartupRearmRequired() &&
		relativeId === GLOBAL.executionMode &&
		isExplicitUserLiveRearmRequest(state, adapter.namespace, relativeId, getBootstrapCompletedAtMs())
	) {
		clearStartupRearmRequired();
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
	const adminUpdated = await persistExecutionModeToAdminConfig(adapter, relativeId, mode);
	adapter.log.info(
		adminUpdated
			? `${relativeId} → ${mode} (Objektbaum, Admin übernommen)`
			: `${relativeId} → ${mode} (Objektbaum)`,
	);
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
