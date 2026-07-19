import { WALLBOX_MAPPING_COMMANDS, wallboxMappingFromConfig, type NativeMappingEntry } from "./mapping_config";
import { mappingBase } from "./tree_paths";

type MappingHost = {
	config: unknown;
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (
		id: string,
		state: ioBroker.SettableState,
	) => Promise<unknown>;
	getObjectAsync?: (id: string) => Promise<ioBroker.Object | null | undefined>;
};

export type EnsureMappingOptions = {
	/** Create allowed_values leaf only when explicitly requested (default: false). */
	ensureAllowedValues?: boolean;
};

/** Roles that have a usable target or an explicit enabled flag in a sparse mapping table. */
export function mappingCommandsFromEntries(
	entries: Record<string, NativeMappingEntry>,
	opts?: { requireTarget?: boolean },
): string[] {
	const requireTarget = opts?.requireTarget !== false;
	return Object.entries(entries)
		.filter(([, entry]) => {
			const hasTarget = typeof entry.target_state === "string" && entry.target_state.trim().length > 0;
			if (requireTarget) {
				return hasTarget;
			}
			return hasTarget || typeof entry.enabled === "boolean" || Boolean(entry.allowed_values?.trim());
		})
		.map(([cmd]) => cmd);
}

export async function ensureAddonMappingStates(
	host: MappingHost,
	addonId: string,
	commands: readonly string[],
	options?: EnsureMappingOptions,
): Promise<void> {
	const ensureAllowed = options?.ensureAllowedValues === true;
	for (const cmd of commands) {
		const base = mappingBase(addonId, cmd);
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
		if (ensureAllowed) {
			await ensureAllowedValuesLeaf(host, base, addonId, cmd);
		}
	}
}

async function ensureAllowedValuesLeaf(
	host: MappingHost,
	base: string,
	addonId: string,
	cmd: string,
): Promise<void> {
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

export type MappingFromConfigFn = (
	config: Record<string, unknown>,
) => Record<string, NativeMappingEntry>;

/** Instanz-native (jsonConfig) → mapping.* States nach Adapter-Start. */
export async function syncNativeMappingToStates(
	host: MappingHost,
	addonId: string,
	fromConfig: MappingFromConfigFn,
): Promise<void> {
	const cfg = host.config;
	if (!cfg || typeof cfg !== "object") {
		return;
	}
	const entries = fromConfig(cfg as Record<string, unknown>);
	for (const [cmd, entry] of Object.entries(entries)) {
		await applyMappingEntry(host, addonId, cmd, entry);
	}
}

async function applyMappingEntry(
	host: MappingHost,
	addonId: string,
	cmd: string,
	entry: NativeMappingEntry,
): Promise<void> {
	const base = mappingBase(addonId, cmd);
	const objectExists = async (id: string): Promise<boolean> => {
		if (typeof host.getObjectAsync !== "function") {
			return true;
		}
		const obj = await host.getObjectAsync(id);
		return Boolean(obj);
	};
	if (typeof entry.enabled === "boolean") {
		const id = `${base}.enabled`;
		if (await objectExists(id)) {
			await host.setStateAsync(id, { val: entry.enabled, ack: true });
		}
	}
	const ts = entry.target_state;
	if (typeof ts === "string" && ts.trim()) {
		const id = `${base}.target_state`;
		if (await objectExists(id)) {
			await host.setStateAsync(id, { val: ts.trim(), ack: true });
		}
	}
	const av = entry.allowed_values;
	if (typeof av === "string" && av.trim()) {
		await ensureAllowedValuesLeaf(host, base, addonId, cmd);
		const id = `${base}.allowed_values`;
		await host.setStateAsync(id, { val: av.trim(), ack: true });
	}
}

export { WALLBOX_MAPPING_COMMANDS, wallboxMappingFromConfig };
