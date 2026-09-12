/** Herstellerübergreifender, read-only Gerätekatalog für Setup/UI/App. */

import { AC_PROFILES } from "../addons/air_conditioning/profiles/registry";
import { BATTERY_PROFILES } from "../addons/battery/profiles/registry";
import type {
	DeviceCapabilityId,
	DeviceClass,
	DeviceIntegrationKind,
	DeviceSetupKind,
	DeviceTemplateKind,
} from "./types";

export type DeviceTemplateCatalogEntry = {
	deviceClass: DeviceClass;
	manufacturerId: string;
	manufacturer: string;
	templateId: string;
	displayNameDe: string;
	templateKind: DeviceTemplateKind;
	integration: DeviceIntegrationKind;
	availability: "implemented";
	capabilities: DeviceCapabilityId[];
	liveControl: boolean;
	executionAuthority: "ems" | "external" | "read_only";
	plannerContract: "normalized_contribution_v1";
	setup: {
		kind: DeviceSetupKind;
		genericFallback: boolean;
		manualMappingAvailable: boolean;
		hintDe: string;
		requiredReadRoles?: string[];
		requiredWriteRoles?: string[];
	};
};

export type DeviceTemplateManufacturerGroup = {
	manufacturerId: string;
	manufacturer: string;
	templates: Array<{
		templateId: string;
		displayNameDe: string;
		genericFallback: boolean;
		liveControl: boolean;
	}>;
};

export type DeviceTemplateClassGroup = {
	deviceClass: DeviceClass;
	labelDe: string;
	manufacturers: DeviceTemplateManufacturerGroup[];
};

export type DeviceTemplateCatalog = {
	schemaVersion: 1;
	generatedFrom: "compiled_profiles";
	plannerContract: "normalized_contribution_v1";
	setupFlow: {
		steps: ["device_class", "manufacturer", "template", "binding"];
		genericFallbackDe: string;
	};
	/** Flache Liste für einfache Filter/API-Clients. */
	entries: DeviceTemplateCatalogEntry[];
	/** Zielstruktur Geräteklasse → Hersteller → Gerät/Template. */
	classes: DeviceTemplateClassGroup[];
};

const CLASS_LABELS: Record<DeviceClass, string> = {
	battery: "Batterie",
	wallbox: "Wallbox",
	climate: "Klima",
	immersion_heater: "Heizstab / Wärme",
};

function hierarchy(entries: DeviceTemplateCatalogEntry[]): DeviceTemplateClassGroup[] {
	const classes = new Map<DeviceClass, Map<string, DeviceTemplateManufacturerGroup>>();
	for (const entry of entries) {
		let manufacturers = classes.get(entry.deviceClass);
		if (!manufacturers) {
			manufacturers = new Map();
			classes.set(entry.deviceClass, manufacturers);
		}
		let manufacturer = manufacturers.get(entry.manufacturerId);
		if (!manufacturer) {
			manufacturer = {
				manufacturerId: entry.manufacturerId,
				manufacturer: entry.manufacturer,
				templates: [],
			};
			manufacturers.set(entry.manufacturerId, manufacturer);
		}
		manufacturer.templates.push({
			templateId: entry.templateId,
			displayNameDe: entry.displayNameDe,
			genericFallback: entry.setup.genericFallback,
			liveControl: entry.liveControl,
		});
	}
	return [...classes.entries()]
		.map(([deviceClass, manufacturers]) => ({
			deviceClass,
			labelDe: CLASS_LABELS[deviceClass],
			manufacturers: [...manufacturers.values()]
				.map((manufacturer) => ({
					...manufacturer,
					templates: manufacturer.templates.sort((a, b) => a.templateId.localeCompare(b.templateId)),
				}))
				.sort((a, b) => a.manufacturerId.localeCompare(b.manufacturerId)),
		}))
		.sort((a, b) => a.deviceClass.localeCompare(b.deviceClass));
}

export function buildDeviceTemplateCatalog(): DeviceTemplateCatalog {
	const entries: DeviceTemplateCatalogEntry[] = [];
	for (const profile of BATTERY_PROFILES) {
		entries.push({
			deviceClass: "battery",
			manufacturerId: profile.catalog.manufacturerId,
			manufacturer: profile.catalog.manufacturerNameDe,
			templateId: profile.id,
			displayNameDe: profile.displayNameDe,
			templateKind: profile.catalog.templateKind,
			integration: profile.catalog.integration,
			availability: "implemented",
			capabilities: [
				...(profile.supportsRead ? (["telemetry", "soc", "power", "capacity"] as DeviceCapabilityId[]) : []),
				...(profile.plannerCapabilities.chargeDispatch ? (["charge_control"] as DeviceCapabilityId[]) : []),
				...(profile.plannerCapabilities.activeDischargeDispatch ? (["discharge_control"] as DeviceCapabilityId[]) : []),
				...(profile.plannerCapabilities.gridBalanceControl ? (["grid_balance"] as DeviceCapabilityId[]) : []),
			],
			liveControl: profile.supportsLive,
			executionAuthority: profile.supportsLive ? "ems" : "read_only",
			plannerContract: "normalized_contribution_v1",
			setup: {
				kind: profile.catalog.setupKind,
				genericFallback: profile.catalog.genericFallback,
				manualMappingAvailable: profile.catalog.manualMappingAvailable,
				hintDe: profile.catalog.setupHintDe,
				requiredReadRoles: [...profile.requiredReadRoles],
				requiredWriteRoles: [...profile.requiredWriteRoles],
			},
		});
	}
	for (const profile of AC_PROFILES) {
		entries.push({
			deviceClass: "climate",
			manufacturerId: profile.catalog.manufacturerId,
			manufacturer: profile.catalog.manufacturerNameDe,
			templateId: profile.id,
			displayNameDe: profile.displayNameDe,
			templateKind: profile.catalog.templateKind,
			integration: profile.catalog.integration,
			availability: "implemented",
			capabilities: [
				"telemetry",
				"temperature",
				"humidity",
				"cooling",
				"heating",
				"dehumidify",
				"hard_off",
				"cleaning",
				"shared_power",
			],
			liveControl: true,
			executionAuthority: "ems",
			plannerContract: "normalized_contribution_v1",
			setup: {
				kind: profile.catalog.setupKind,
				genericFallback: profile.catalog.genericFallback,
				manualMappingAvailable: profile.catalog.manualMappingAvailable,
				hintDe: profile.catalog.setupHintDe,
			},
		});
	}
	entries.push(
		{
			deviceClass: "wallbox",
			manufacturerId: "evcc",
			manufacturer: "EVCC",
			templateId: "evcc_generic",
			displayNameDe: "EVCC (herstellerübergreifend)",
			templateKind: "generic",
			integration: "evcc",
			availability: "implemented",
			capabilities: [
				"telemetry",
				"presence",
				"vehicle_soc",
				"target_soc",
				"remaining_energy",
				"charge_mode",
				"charge_current",
			],
			liveControl: true,
			executionAuthority: "external",
			plannerContract: "normalized_contribution_v1",
			setup: {
				kind: "adapter_instance",
				genericFallback: true,
				manualMappingAvailable: true,
				hintDe: "Vorhandene EVCC-Instanz auswählen und deren normalisierte Status-/Control-Datenpunkte zuordnen.",
			},
		},
		{
			deviceClass: "immersion_heater",
			manufacturerId: "generic",
			manufacturer: "Generisch",
			templateId: "generic_mapping",
			displayNameDe: "Heizstab (Mapping-basiert)",
			templateKind: "generic",
			integration: "state_mapping",
			availability: "implemented",
			capabilities: ["temperature", "staged_power", "feedback", "hygiene", "safety_lockout"],
			liveControl: true,
			executionAuthority: "ems",
			plannerContract: "normalized_contribution_v1",
			setup: {
				kind: "manual_mapping",
				genericFallback: true,
				manualMappingAvailable: true,
				hintDe: "Temperatur-, Stufen-, Feedback- und Safety-Datenpunkte manuell zuordnen.",
			},
		},
	);
	entries.sort(
		(a, b) => a.deviceClass.localeCompare(b.deviceClass) || a.templateId.localeCompare(b.templateId),
	);
	return {
		schemaVersion: 1,
		generatedFrom: "compiled_profiles",
		plannerContract: "normalized_contribution_v1",
		setupFlow: {
			steps: ["device_class", "manufacturer", "template", "binding"],
			genericFallbackDe:
				"Unbekannte Geräte verwenden ein vorhandenes generisches Mapping beziehungsweise EVCC; LIVE bleibt von Profil-, Mapping- und Safety-Readiness abhängig.",
		},
		entries,
		classes: hierarchy(entries),
	};
}
