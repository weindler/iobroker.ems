/** Zentrale State-Pfade unter ems.&lt;instanz&gt; (Objektbaum-Schema v0.1). */

export const GLOBAL = {
	executionMode: "global.execution_mode",
} as const;

export const COMMAND = {
	inbox: "command.inbox",
	lastResult: "command.last_result",
} as const;

export const AUDIT = {
	lastEvent: "audit.last_event",
	addonLastEvent: (addonId: string) => `audit.${addonId}.last_event`,
} as const;

export function addonBase(addonId: string): string {
	return `addons.${addonId}`;
}

export function addonMode(addonId: string): string {
	return `${addonBase(addonId)}.mode`;
}

export function addonEnabled(addonId: string): string {
	return `${addonBase(addonId)}.enabled`;
}

export function addonAvailable(addonId: string): string {
	return `${addonBase(addonId)}.available`;
}

/** Mapping nur unter addons.&lt;id&gt;.mapping.&lt;role&gt;.* */
export function mappingBase(addonId: string, role: string): string {
	return `${addonBase(addonId)}.mapping.${role}`;
}

export function addonDryrunBase(addonId: string): string {
	return `${addonBase(addonId)}.dryrun`;
}

export function addonStatusBase(addonId: string): string {
	return `${addonBase(addonId)}.status`;
}

/** Kanäle für übersichtlichen ioBroker-Objektbaum (ohne States). */
export const CHANNEL_IDS = [
	"global",
	"ems_mirror",
	"command",
	"audit",
	"addons",
	"addons.wallbox",
	"addons.battery",
	"addons.immersion_heater",
	"addons.dynamic_tariff",
] as const;
