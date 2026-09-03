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
		id: "daily_evaluator_findings",
		category: "support_only",
		fileCategory: "learning/daily_evaluator/findings",
		fileName: "YYYY-MM-DD.json",
		description: "Block A Daily-Evaluator Findings pro Tag — rebuildable aus day_telemetry",
	},
	{
		id: "daily_evaluator_scores",
		category: "support_only",
		fileCategory: "learning/daily_evaluator/scores",
		fileName: "YYYY-MM-DD.json",
		description: "Block A Daily-Evaluator Domain-/GlobalScores pro Tag — rebuildable aus day_telemetry",
	},
	{
		id: "daily_evaluator_learning_state",
		category: "restorable",
		fileCategory: "learning/daily_evaluator",
		fileName: "learning_state_v1.json",
		description: "Block A diagnostischer Learning-State (eigenständig, kein Einfluss auf reales Planner-/Control-Verhalten)",
	},
	{
		id: "climate_shared_power",
		category: "restorable",
		fileCategory: "learning/climate_shared_power",
		fileName: "climate_shared_power_v1.json",
		description: "Phase 3 gelernte Shared-Power-Klimastatistiken (Median/p75/Confidence je Gruppe×Modus×Kombination)",
	},
	{
		id: "climate_thermal",
		category: "restorable",
		fileCategory: "learning/climate_thermal",
		fileName: "climate_thermal_v1.json",
		description: "Predictive-Climate-Foundation: empirische Raum-/Mode-Raten (passiv/cooling/heating/dehumidify) — Diagnose, keine Steuerung",
	},
	{
		id: "shadow_engine_results",
		category: "support_only",
		fileCategory: "learning/shadow_engine/results",
		fileName: "YYYY-MM-DD.json",
		description: "Phase 5 Shadow-/Counterfactual-Ergebnisse pro Tag — rebuildable aus day_telemetry + Statistik",
	},
	{
		id: "economics",
		category: "restorable",
		fileCategory: "economics",
		fileName: "economics_v1.json",
		description: "Phase 7 Wirtschaftlichkeits-Historie (Tarifvorteil/EMS-Vorteil/KI-Mehrwert je Tag) — belastbare Accounting-Historie",
	},
	{
		id: "ai_override_ledger",
		category: "restorable",
		fileCategory: "ai/override_ledger",
		fileName: "override_ledger_v1.json",
		description: "Phase 6 KI-Override-Ledger (validierte, zeitlich begrenzte Overrides) — Entscheidungs-Historie",
	},
	{
		id: "ai_daily_analyst_findings",
		category: "support_only",
		fileCategory: "ai/daily_analyst/findings",
		fileName: "YYYY-MM-DD.json",
		description:
			"Phase 4 KI-Daily-Analyst Findings pro Tag — reproduzierbar durch erneuten KI-Lauf mit denselben Eingabedaten, kein Backup-Anspruch",
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
