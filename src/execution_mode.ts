import { GLOBAL, addonMode } from "./tree_paths";

export type ExecutionMode = "dryrun" | "live";

export interface ExecutionModeHost {
	getStateAsync: (id: string) => Promise<ioBroker.State | null | undefined>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
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

export async function ensureGlobalExecutionStates(host: ExecutionModeHost): Promise<void> {
	await host.setObjectNotExistsAsync(GLOBAL.executionMode, {
		type: "state",
		common: {
			name: "Global: Ausführung (dryrun|live)",
			type: "string",
			role: "text",
			read: true,
			write: true,
			def: "dryrun",
		},
		native: {},
	} as ioBroker.Object);

	const cur = await host.getStateAsync(GLOBAL.executionMode);
	if (cur?.val === undefined || cur.val === null || cur.val === "") {
		await host.setStateAsync(GLOBAL.executionMode, { val: "dryrun", ack: true });
	}
}

export async function syncExecutionModesFromConfig(
	host: ExecutionModeHost,
	config: Record<string, unknown>,
): Promise<void> {
	const c = config as GlobalExecutionConfig;
	const globalMode = parseMode(c.global_execution_mode ?? "dryrun");
	await host.setStateAsync(GLOBAL.executionMode, { val: globalMode, ack: true });

	const wb = parseMode(c.wb_addon_mode ?? "dryrun");
	await host.setStateAsync(addonMode("wallbox"), { val: wb, ack: true });

	const bat = parseMode(c.bat_addon_mode ?? "dryrun");
	await host.setStateAsync(addonMode("battery"), { val: bat, ack: true });

	const ih = parseMode(c.ih_addon_mode ?? "dryrun");
	await host.setStateAsync(addonMode("immersion_heater"), { val: ih, ack: true });
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
