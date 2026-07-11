import { EMS_ADDON_IDS, type EmsAddonId } from "../addons/registry";
import type { OperatorAddonRegistration, PlanRole } from "./types";

const REGISTRY: OperatorAddonRegistration[] = [
	{
		addonId: "sensorics",
		roles: ["infrastructure"],
		canContributeToPlan: false,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "inverter_1",
		roles: ["supply", "infrastructure"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "inverter_2",
		roles: ["supply", "infrastructure"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "inverter_3",
		roles: ["supply", "infrastructure"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "pv_plant",
		roles: ["supply"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "pv_forecast",
		roles: ["supply"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "weather_live",
		roles: ["supply"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "weather_forecast",
		roles: ["supply"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "dynamic_tariff",
		roles: ["supply"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "fixed_tariff",
		roles: ["supply"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "house_main_fuse",
		roles: ["constraint"],
		canContributeToPlan: true,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "series_storage",
		roles: ["infrastructure"],
		canContributeToPlan: false,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "battery",
		roles: ["storage", "supply", "demand_flex", "constraint", "dispatch"],
		canContributeToPlan: true,
		canDispatch: true,
		requiresGovernance: true,
	},
	{
		addonId: "wallbox",
		roles: ["demand_flex", "dispatch"],
		canContributeToPlan: true,
		canDispatch: true,
		requiresGovernance: true,
	},
	{
		addonId: "heating",
		roles: ["demand_flex"],
		canContributeToPlan: false,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "heat_pump",
		roles: ["demand_flex", "dispatch"],
		canContributeToPlan: false,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "immersion_heater",
		roles: ["demand_flex", "dispatch"],
		canContributeToPlan: true,
		canDispatch: true,
		requiresGovernance: true,
	},
	{
		addonId: "consumer_1",
		roles: ["demand_flex"],
		canContributeToPlan: false,
		canDispatch: false,
		requiresGovernance: false,
	},
	{
		addonId: "air_conditioning",
		roles: ["demand_flex", "dispatch"],
		canContributeToPlan: true,
		canDispatch: true,
		requiresGovernance: true,
	},
];

const BY_ID = new Map<EmsAddonId, OperatorAddonRegistration>(
	REGISTRY.map((entry) => [entry.addonId, entry]),
);

export const OPERATOR_ADDON_REGISTRY: readonly OperatorAddonRegistration[] = REGISTRY;

export function operatorAddonRegistration(addonId: EmsAddonId): OperatorAddonRegistration {
	const entry = BY_ID.get(addonId);
	if (!entry) {
		throw new Error(`operator registry missing addon: ${addonId}`);
	}
	return entry;
}

export function operatorRegistryCoversAllCatalogAddons(): boolean {
	return EMS_ADDON_IDS.every((id) => BY_ID.has(id));
}

export function operatorRegistryAddonIds(): EmsAddonId[] {
	return REGISTRY.map((e) => e.addonId);
}

export function operatorAddonsWithRole(role: PlanRole): OperatorAddonRegistration[] {
	return REGISTRY.filter((e) => e.roles.includes(role));
}
