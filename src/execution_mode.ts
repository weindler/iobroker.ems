import { GLOBAL, addonMode } from "./tree_paths";

/** Global: nur Dryrun|Live (kein Off). */
export type GlobalExecutionMode = "dryrun" | "live";

/** Add-on: Aus|Dryrun|Live — Off = keine EMS-Participation. */
export type AddonExecutionMode = "off" | "dryrun" | "live";

/**
 * Historischer Alias: Add-on-Modus inkl. off.
 * Global immer über parseGlobalMode lesen.
 */
export type ExecutionMode = AddonExecutionMode;

export const GLOBAL_EXECUTION_MODES = ["dryrun", "live"] as const;
export const ADDON_EXECUTION_MODES = ["off", "dryrun", "live"] as const;
/** @deprecated use ADDON_EXECUTION_MODES / GLOBAL_EXECUTION_MODES */
export const EXECUTION_MODES = ADDON_EXECUTION_MODES;

export const GLOBAL_EXECUTION_MODE_STATE_LABELS: Record<GlobalExecutionMode, string> = {
	dryrun: "Dryrun (keine realen Schaltbefehle)",
	live: "Live (Writes nur für Add-ons auf Live)",
};

export const ADDON_EXECUTION_MODE_STATE_LABELS: Record<AddonExecutionMode, string> = {
	off: "Aus (EMS-Light übernimmt nicht)",
	dryrun: "Dryrun (plant/simuliert, keine Writes)",
	live: "Live (plant und steuert bei Global Live)",
};

export const EXECUTION_MODE_STATE_LABELS: Record<AddonExecutionMode, string> = ADDON_EXECUTION_MODE_STATE_LABELS;

export const GLOBAL_EXECUTION_MODE_STATES: Record<string, string> = {
	dryrun: GLOBAL_EXECUTION_MODE_STATE_LABELS.dryrun,
	live: GLOBAL_EXECUTION_MODE_STATE_LABELS.live,
};

export const ADDON_EXECUTION_MODE_STATES: Record<string, string> = {
	off: ADDON_EXECUTION_MODE_STATE_LABELS.off,
	dryrun: ADDON_EXECUTION_MODE_STATE_LABELS.dryrun,
	live: ADDON_EXECUTION_MODE_STATE_LABELS.live,
};

/** @deprecated use ADDON_EXECUTION_MODE_STATES for addon objects */
export const EXECUTION_MODE_STATES: Record<string, string> = ADDON_EXECUTION_MODE_STATES;

/** Addons mit off|dryrun|live-Schalter (Admin + Objektbaum). */
export const EXECUTION_MODE_ADDON_IDS = ["wallbox", "battery", "immersion_heater", "air_conditioning"] as const;

export type ExecutionModeAddonId = (typeof EXECUTION_MODE_ADDON_IDS)[number];

const ADDON_EXECUTION_MODE_NAMES: Record<ExecutionModeAddonId, string> = {
	wallbox: "Wallbox: Aus | Dryrun | Live",
	battery: "Batterie: Aus | Dryrun | Live",
	immersion_heater: "Heizstab: Aus | Dryrun | Live",
	air_conditioning: "Klima: Aus | Dryrun | Live",
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
	global: GlobalExecutionMode;
	wallbox: AddonExecutionMode;
	battery: AddonExecutionMode;
	immersion_heater: AddonExecutionMode;
	air_conditioning: AddonExecutionMode;
}

export function parseGlobalMode(raw: unknown): GlobalExecutionMode {
	return String(raw ?? "dryrun").toLowerCase() === "live" ? "live" : "dryrun";
}

export function parseAddonMode(raw: unknown): AddonExecutionMode {
	const s = String(raw ?? "dryrun").toLowerCase();
	if (s === "live") return "live";
	if (s === "off") return "off";
	return "dryrun";
}

/**
 * Add-on-Modus (inkl. off). Für Global immer parseGlobalMode verwenden —
 * „off“ am Global-State wird zu dryrun geklemmt.
 */
export function parseMode(raw: unknown): AddonExecutionMode {
	return parseAddonMode(raw);
}

export function isAddonExecutionOff(raw: unknown): boolean {
	return parseAddonMode(raw) === "off";
}

export function executionModesFromConfig(config: Record<string, unknown>): ExecutionModeConfigModes {
	const c = config as GlobalExecutionConfig;
	return {
		global: parseGlobalMode(c.global_execution_mode ?? "dryrun"),
		wallbox: parseAddonMode(c.wb_addon_mode ?? "dryrun"),
		battery: parseAddonMode(c.bat_addon_mode ?? "dryrun"),
		immersion_heater: parseAddonMode(c.ih_addon_mode ?? "dryrun"),
		air_conditioning: parseAddonMode(c.ac_addon_mode ?? "dryrun"),
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

export function executionModeCommon(
	name: string,
	def: AddonExecutionMode = "dryrun",
	kind: "global" | "addon" = "addon",
): ioBroker.StateCommon {
	return {
		name,
		type: "string",
		role: "value",
		read: true,
		write: true,
		def: kind === "global" ? parseGlobalMode(def) : def,
		states: kind === "global" ? GLOBAL_EXECUTION_MODE_STATES : ADDON_EXECUTION_MODE_STATES,
	};
}

export async function isLiveWriteAllowed(
	getState: (id: string) => Promise<ioBroker.State | null | undefined>,
	addonId: string,
): Promise<boolean> {
	const global = await getState(GLOBAL.executionMode);
	if (parseGlobalMode(global?.val) !== "live") {
		return false;
	}
	const addon = await getState(addonMode(addonId));
	return parseAddonMode(addon?.val) === "live";
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

function hasGlobalExecutionModeValue(val: unknown): boolean {
	const s = String(val ?? "").trim().toLowerCase();
	return s === "dryrun" || s === "live";
}

function hasAddonExecutionModeValue(val: unknown): boolean {
	const s = String(val ?? "").trim().toLowerCase();
	return s === "off" || s === "dryrun" || s === "live";
}

function hasExecutionModeValue(val: unknown): boolean {
	return hasAddonExecutionModeValue(val) || hasGlobalExecutionModeValue(val);
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

export type ForceDryrunReason = "namespace_cold_start" | "restore_recovery";

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
	const global = await host.getStateAsync(GLOBAL.executionMode);
	if (!hasGlobalExecutionModeValue(global?.val)) return true;
	for (const addonId of EXECUTION_MODE_ADDON_IDS) {
		const cur = await host.getStateAsync(addonMode(addonId));
		if (!hasAddonExecutionModeValue(cur?.val)) return true;
	}
	return false;
}

async function mirrorGlobalExecutionSafety(host: ExecutionModeHost): Promise<void> {
	const global = await host.getStateAsync(GLOBAL.executionMode);
	await host.setStateAsync("execution.safety.global_execution_mode", {
		val: parseGlobalMode(global?.val),
		ack: true,
	});
}

export async function ensureGlobalExecutionStates(host: ExecutionModeHost): Promise<void> {
	await ensureExecutionModeObject(
		host,
		GLOBAL.executionMode,
		executionModeCommon("Global: Ausführung (dryrun|live)", "dryrun", "global"),
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
			executionModeCommon(ADDON_EXECUTION_MODE_NAMES[addonId], "dryrun", "addon"),
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
	const globalSt = await host.getStateAsync(GLOBAL.executionMode);
	if (globalSt && hasGlobalExecutionModeValue(globalSt.val)) {
		const mode = parseGlobalMode(globalSt.val);
		if (parseGlobalMode(base.global_execution_mode) !== mode) {
			base.global_execution_mode = mode;
			changed = true;
		}
	}
	const addonPairs: Array<[string, keyof GlobalExecutionConfig]> = [
		[addonMode("wallbox"), "wb_addon_mode"],
		[addonMode("battery"), "bat_addon_mode"],
		[addonMode("immersion_heater"), "ih_addon_mode"],
		[addonMode("air_conditioning"), "ac_addon_mode"],
	];
	for (const [stateId, configKey] of addonPairs) {
		const st = await host.getStateAsync(stateId);
		if (!st || !hasAddonExecutionModeValue(st.val)) continue;
		const mode = parseAddonMode(st.val);
		if (parseAddonMode(base[configKey]) !== mode) {
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
		const dryrunNative = clampNativeExecutionModesDryrun(config);
		let nativeClamped = false;
		if (typeof host.updateConfig === "function") {
			await host.updateConfig(dryrunNative);
			nativeClamped = true;
		}
		await applyExecutionModesFromConfig(host, ALL_DRYRUN_MODES);
		await host.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, {
			val: executionModesConfigFingerprint(nativeClamped ? dryrunNative : config),
			ack: true,
		});
		await mirrorGlobalExecutionSafety(host);
		if (forceReason === "restore_recovery") {
			host.log?.info?.(
				"Restore-Recovery: Ausführungsmodi in Native und Objektbaum auf dryrun gesetzt",
			);
		} else {
			host.log?.info?.(
				nativeClamped
					? "Cold-Start-Recovery: Ausführungsmodi in Native und Objektbaum auf dryrun gesetzt"
					: "Cold-Start-Recovery: Ausführungsmodi auf dryrun geklemmt (Admin-Config ohne updateConfig unverändert)",
			);
		}
		return;
	}

	if (!prevFingerprint && !empty) {
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
	mode: string,
): Promise<boolean> {
	const configKey = executionModeConfigKeyForRelativeId(relativeId);
	if (!configKey || typeof adapter.updateConfig !== "function") {
		return false;
	}
	const base =
		adapter.config && typeof adapter.config === "object"
			? ({ ...(adapter.config as Record<string, unknown>) } as Record<string, unknown>)
			: {};
	const next =
		configKey === "global_execution_mode" ? parseGlobalMode(mode) : parseAddonMode(mode);
	const prev =
		configKey === "global_execution_mode"
			? parseGlobalMode(base[configKey])
			: parseAddonMode(base[configKey]);
	if (prev === next) {
		await adapter.setStateAsync(EXECUTION_MODE_CONFIG_FINGERPRINT, {
			val: executionModesConfigFingerprint(base),
			ack: true,
		});
		return false;
	}
	base[configKey] = next;
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

export type AddonModeReplanHook = (info: {
	addonId: ExecutionModeAddonId | "global";
	relativeId: string;
	previous: string | null;
	next: AddonExecutionMode | GlobalExecutionMode;
}) => void;

let addonModeReplanHook: AddonModeReplanHook | null = null;

/** Daily-Plan-Tick registriert sich hier, um bei Mode-Wechsel frisch zu replannen. */
export function setAddonModeReplanHook(hook: AddonModeReplanHook | null): void {
	addonModeReplanHook = hook;
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

	const requested = String(state.val ?? "").trim().toLowerCase();
	const isGlobal = relativeId === GLOBAL.executionMode;
	let mode: GlobalExecutionMode | AddonExecutionMode;
	if (isGlobal) {
		if (requested === "off") {
			adapter.log.warn?.(
				`${relativeId}: „off“ ist nur für Add-ons gültig — Global bleibt dryrun|live (Fallback dryrun)`,
			);
			mode = "dryrun";
		} else {
			mode = parseGlobalMode(state.val);
			if (requested !== "" && requested !== "dryrun" && requested !== "live") {
				adapter.log.warn?.(
					`${relativeId}: ungültiger Wert „${state.val}“ — Fallback auf ${mode}`,
				);
			}
		}
	} else {
		mode = parseAddonMode(state.val);
		if (requested !== "" && requested !== "off" && requested !== "dryrun" && requested !== "live") {
			adapter.log.warn?.(
				`${relativeId}: ungültiger Wert „${state.val}“ — Fallback auf ${mode}`,
			);
		}
	}

	const prevRaw = await adapter.getStateAsync(relativeId);
	const previous = prevRaw?.val != null ? String(prevRaw.val) : null;

	await adapter.setStateAsync(relativeId, { val: mode, ack: true });
	if (isGlobal) {
		await adapter.setStateAsync("execution.safety.global_execution_mode", { val: mode, ack: true });
	}
	const adminUpdated = await persistExecutionModeToAdminConfig(adapter, relativeId, mode);
	adapter.log.info(
		adminUpdated
			? `${relativeId} → ${mode} (Objektbaum, Admin übernommen)`
			: `${relativeId} → ${mode} (Objektbaum)`,
	);

	if (addonModeReplanHook) {
		const addonId = isGlobal
			? ("global" as const)
			: (EXECUTION_MODE_ADDON_IDS.find((a) => relativeId === addonMode(a)) ?? "global");
		try {
			addonModeReplanHook({ addonId, relativeId, previous, next: mode });
		} catch {
			// best-effort
		}
	}
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
