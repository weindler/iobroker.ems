import type { PersistenceClass } from "./types";

export interface PersistenceSourceDef {
	id: string;
	category: PersistenceClass;
	/** Relativer Pfad im Archiv (backup) oder diagnostics (support). */
	archivePath?: string;
	statePrefix?: string;
	fileCategory?: string;
	fileName?: string;
	description: string;
}

/** Explizite Klassifikation aller bekannten Persistenzquellen. */
export const PERSISTENCE_INVENTORY: readonly PersistenceSourceDef[] = [
	{
		id: "adapter_config",
		category: "restorable",
		archivePath: "config/adapter.json",
		description: "Allowlist-native Adapterkonfiguration",
	},
	{
		id: "mappings",
		category: "restorable",
		archivePath: "config/mappings.json",
		description: "Add-on-Mapping-Konfiguration",
	},
	{
		id: "vehicle_profiles",
		category: "restorable",
		archivePath: "config/vehicle_profiles.json",
		description: "Wallbox Fahrzeug-Mini-Map (wb_vehicle_map; Archivpfad historisch)",
	},
	{
		id: "learning_mirror",
		category: "restorable",
		archivePath: "persistence/learning.json",
		description: "Learning-Spiegelstates / Dateien",
	},
	{
		id: "intent_persist",
		category: "transient",
		fileCategory: "intent",
		fileName: "intent_v1.json",
		description: "Aktive Intent-Persistenz (nicht restorefähig)",
	},
	{
		id: "policy_global",
		category: "restorable",
		fileCategory: "policy",
		fileName: "policy_global_v1.json",
		description: "Policy-Global-Persistenz (nur konfigurierte Regeln, nicht in selected_state_data)",
	},
	{
		id: "global_modes",
		category: "transient",
		fileCategory: "global_modes",
		fileName: "global_modes_v1.json",
		description: "Laufende Global-Mode-Auflösung (nicht restorefähig)",
	},
	{
		id: "vehicle_rollforward",
		category: "support_only",
		statePrefix: "addons.wallbox.vehicles.",
		description: "Rollforward-Anker (estimation.baseline_*)",
	},
	{
		id: "vehicle_last_trusted",
		category: "support_only",
		statePrefix: "addons.wallbox.vehicles.",
		description: "Last-Trusted-Snapshot (estimation.last_trusted_*)",
	},
	{
		id: "battery_fsm",
		category: "support_only",
		statePrefix: "addons.battery.status.",
		description: "Battery-FSM-Status",
	},
	{
		id: "immersion_runtime",
		category: "support_only",
		fileCategory: "immersion_heater",
		fileName: "immersion_heater_runtime_v1.json",
		description: "Heizstab-Runtime-Persistenz",
	},
	{
		id: "ac_runtime",
		category: "support_only",
		fileCategory: "air_conditioning",
		fileName: "air_conditioning_runtime_v1.json",
		description: "Klima-Runtime-Persistenz",
	},
	{
		id: "day_telemetry",
		category: "support_only",
		fileCategory: "learning/day_telemetry",
		fileName: "YYYY-MM-DD.json",
		description: "Roh-Tagestelemetrie als Tagesdateien (Detailhistorie, nicht restore-kritisch)",
	},
	{
		id: "command_inbox",
		category: "transient",
		description: "Command Inbox",
	},
	{
		id: "active_intents",
		category: "transient",
		description: "Aktive Intents / Planner-Ausgaben",
	},
	{
		id: "live_telemetry",
		category: "excluded",
		description: "Aktuelle SOC/Leistung/Relaiszustände",
	},
];

export function inventoryExportJson(): { schema_version: number; sources: PersistenceSourceDef[] } {
	return {
		schema_version: 1,
		sources: [...PERSISTENCE_INVENTORY],
	};
}

export function restorableSources(): PersistenceSourceDef[] {
	return PERSISTENCE_INVENTORY.filter((s) => s.category === "restorable");
}

export function supportOnlySources(): PersistenceSourceDef[] {
	return PERSISTENCE_INVENTORY.filter((s) => s.category === "support_only");
}
