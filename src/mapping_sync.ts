import type { EmsNativeConfig, NativeMappingEntry } from "./mapping_config";

type MappingHost = {
	config: unknown;
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (
		id: string,
		state: ioBroker.SettableState,
	) => Promise<unknown>;
};

export async function ensureAddonMappingStates(
	host: MappingHost,
	addonId: string,
	commands: readonly string[],
): Promise<void> {
	for (const cmd of commands) {
		const base = `mapping.${addonId}.${cmd}`;
		await host.setObjectNotExistsAsync(`${base}.enabled`, {
			type: "state",
			common: {
				name: `${addonId} ${cmd} mapping enabled`,
				type: "boolean",
				role: "switch",
				read: true,
				write: true,
				def: true,
			},
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync(`${base}.target_state`, {
			type: "state",
			common: {
				name: `${addonId} ${cmd} target state id`,
				type: "string",
				role: "text",
				read: true,
				write: true,
			},
			native: {},
		} as ioBroker.Object);
		await host.setObjectNotExistsAsync(`${base}.allowed_values`, {
			type: "state",
			common: {
				name: `${addonId} ${cmd} allowed values (JSON array)`,
				type: "string",
				role: "json",
				read: true,
				write: true,
			},
			native: {},
		} as ioBroker.Object);
	}
}

/** Instanz-native (Admin) → mapping.* States; überschreibt nicht, wenn native leer. */
export async function syncNativeMappingToStates(
	host: MappingHost,
	addonId: string,
): Promise<void> {
	const native = host.config as EmsNativeConfig;
	const block = native.mapping?.[addonId];
	if (!block || typeof block !== "object") {
		return;
	}
	for (const [cmd, entry] of Object.entries(block)) {
		if (!entry || typeof entry !== "object") continue;
		await applyMappingEntry(host, addonId, cmd, entry);
	}
}

async function applyMappingEntry(
	host: MappingHost,
	addonId: string,
	cmd: string,
	entry: NativeMappingEntry,
): Promise<void> {
	const base = `mapping.${addonId}.${cmd}`;
	if (typeof entry.enabled === "boolean") {
		await host.setStateAsync(`${base}.enabled`, { val: entry.enabled, ack: true });
	}
	const ts = entry.target_state;
	if (typeof ts === "string" && ts.trim()) {
		await host.setStateAsync(`${base}.target_state`, { val: ts.trim(), ack: true });
	}
	const av = entry.allowed_values;
	if (typeof av === "string" && av.trim()) {
		await host.setStateAsync(`${base}.allowed_values`, { val: av.trim(), ack: true });
	}
}
