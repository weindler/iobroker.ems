/** Gemeinsame Metadaten für herstellerübergreifende Geräteprofile. */

export type DeviceClass = "battery" | "wallbox" | "climate" | "immersion_heater";

export type DeviceIntegrationKind = "state_mapping" | "evcc";

export type DeviceSetupKind = "manual_mapping" | "adapter_instance";

export type DeviceTemplateKind = "manufacturer" | "generic";

export type DeviceCapabilityId =
	| "telemetry"
	| "soc"
	| "power"
	| "capacity"
	| "charge_control"
	| "discharge_control"
	| "grid_balance"
	| "presence"
	| "vehicle_soc"
	| "target_soc"
	| "remaining_energy"
	| "charge_mode"
	| "charge_current"
	| "temperature"
	| "humidity"
	| "cooling"
	| "heating"
	| "dehumidify"
	| "hard_off"
	| "cleaning"
	| "shared_power"
	| "staged_power"
	| "feedback"
	| "hygiene"
	| "safety_lockout";

/**
 * Katalogteil eines Runtime-Profils. Herstellerwissen bleibt damit im Profil und wird nicht
 * aus Template-IDs erraten. `genericFallback` bedeutet nicht automatisch LIVE-Freigabe.
 */
export interface DeviceProfileCatalogMetadata {
	manufacturerId: string;
	manufacturerNameDe: string;
	templateKind: DeviceTemplateKind;
	integration: DeviceIntegrationKind;
	setupKind: DeviceSetupKind;
	genericFallback: boolean;
	manualMappingAvailable: boolean;
	setupHintDe: string;
}

/** Herstellerneutrale Planner-Fähigkeiten eines Batterieprofils. */
export interface BatteryPlannerCapabilities {
	chargeDispatch: boolean;
	activeDischargeDispatch: boolean;
	passiveSelfConsumption: boolean;
	gridBalanceControl: boolean;
}
