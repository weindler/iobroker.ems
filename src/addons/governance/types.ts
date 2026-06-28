export type GovernedAddonId = "wallbox" | "immersion_heater" | "battery" | "climate";

export interface AddonGovernance {
	enabled: boolean;
	aiOptimizationAllowed: boolean;
}

export interface GovernedAddonRegistryEntry {
	id: GovernedAddonId;
	displayNameDe: string;
	displayNameEn: string;
	enabledConfigKey: string;
	aiAllowedConfigKey: string;
	/** Runtime addon id used for addons.<id>.enabled sync and pipeline gates. */
	runtimeAddonId: string;
}
