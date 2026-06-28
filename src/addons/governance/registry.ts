import type { GovernedAddonId, GovernedAddonRegistryEntry } from "./types";

export const GOVERNED_ADDON_REGISTRY: readonly GovernedAddonRegistryEntry[] = [
	{
		id: "wallbox",
		displayNameDe: "Wallbox",
		displayNameEn: "Wallbox",
		enabledConfigKey: "wallbox_enabled",
		aiAllowedConfigKey: "wallbox_ai_optimization_allowed",
		runtimeAddonId: "wallbox",
	},
	{
		id: "immersion_heater",
		displayNameDe: "Heizstab",
		displayNameEn: "Immersion heater",
		enabledConfigKey: "immersion_heater_enabled",
		aiAllowedConfigKey: "immersion_heater_ai_optimization_allowed",
		runtimeAddonId: "immersion_heater",
	},
	{
		id: "battery",
		displayNameDe: "Batterie",
		displayNameEn: "Battery",
		enabledConfigKey: "battery_enabled",
		aiAllowedConfigKey: "battery_ai_optimization_allowed",
		runtimeAddonId: "battery",
	},
	{
		id: "climate",
		displayNameDe: "Klimaanlage",
		displayNameEn: "Air conditioning",
		enabledConfigKey: "climate_enabled",
		aiAllowedConfigKey: "climate_ai_optimization_allowed",
		runtimeAddonId: "air_conditioning",
	},
] as const;

const BY_ID = new Map<GovernedAddonId, GovernedAddonRegistryEntry>(
	GOVERNED_ADDON_REGISTRY.map((e) => [e.id, e]),
);

const BY_RUNTIME_ID = new Map<string, GovernedAddonRegistryEntry>(
	GOVERNED_ADDON_REGISTRY.map((e) => [e.runtimeAddonId, e]),
);

export function governedAddonEntry(id: GovernedAddonId): GovernedAddonRegistryEntry {
	const entry = BY_ID.get(id);
	if (!entry) {
		throw new Error(`unknown governed addon: ${id}`);
	}
	return entry;
}

export function governedAddonByRuntimeId(runtimeAddonId: string): GovernedAddonRegistryEntry | null {
	return BY_RUNTIME_ID.get(runtimeAddonId) ?? null;
}

export function isGovernedAddonId(id: string): id is GovernedAddonId {
	return BY_ID.has(id as GovernedAddonId);
}

export function governedAddonIds(): GovernedAddonId[] {
	return GOVERNED_ADDON_REGISTRY.map((e) => e.id);
}
