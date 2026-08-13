/**
 * Phase 4A — read-only production state-surface catalog.
 * Does not create, modify, or delete ioBroker objects.
 */

export type StateSurfaceClass =
	| "A_core_user"
	| "B_advanced_user"
	| "C_temporary_diagnostics"
	| "D_internal_file_data"
	| "E_obsolete"
	| "F_compatibility_contract";

export interface StateSurfaceFamily {
	id: string;
	label: string;
	idPattern: string;
	/** Static leaf states defined in code (approximate when dynamic). */
	estimatedStaticCount: number;
	/** Extra dynamic multiplier notes. */
	dynamicNote?: string;
	dataTypes: string[];
	readWrite: "mostly_read" | "mixed" | "mostly_write" | "buttons";
	producer: string;
	consumers: string[];
	persistenceNeed: "none" | "session" | "durable_state" | "file_preferred";
	avgOrMaxSizeHint: string;
	publicFeature: boolean;
	targetClass: StateSurfaceClass;
	migrationStrategy: string;
	largeJsonIds?: string[];
}

/** Catalog of known families — counts are code-derived estimates, not live instance scans. */
export const STATE_SURFACE_FAMILIES: StateSurfaceFamily[] = [
	{
		id: "global",
		label: "Global / execution mode",
		idPattern: "global.* | command.* | audit.* | addons.<id>.{enabled,available,mode}",
		estimatedStaticCount: 50,
		dataTypes: ["string", "boolean"],
		readWrite: "mixed",
		producer: "bootstrap/base_ensure, execution_mode",
		consumers: ["pipeline", "addons", "admin"],
		persistenceNeed: "durable_state",
		avgOrMaxSizeHint: "scalars",
		publicFeature: true,
		targetClass: "A_core_user",
		migrationStrategy: "Keep compact; do not expand further.",
	},
	{
		id: "runtime_execution",
		label: "EMS-Light live / system / economics / safety",
		idPattern: "system.* | live.* | execution.safety.* | economics.* | operator.briefing_de | operator.diagnostics.*",
		estimatedStaticCount: 39,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mostly_read",
		producer: "ems_light/ensure_states, tick",
		consumers: ["VIS (partial)", "operator UI"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "scalars",
		publicFeature: true,
		targetClass: "A_core_user",
		migrationStrategy: "Keep condensed live strip; drop unused stubs.",
	},
	{
		id: "global_modes_policy",
		label: "Global modes + policy JSON",
		idPattern: "global_modes.* | policy.system.* | policy.global.* | policy.<type>.<instance>.*",
		estimatedStaticCount: 26,
		dynamicNote: "+8 per registered addon policy instance",
		dataTypes: ["string", "boolean"],
		readWrite: "mixed",
		producer: "global_modes/ensure_states, policy/global/ensure_states",
		consumers: ["policy engine", "operator"],
		persistenceNeed: "durable_state",
		avgOrMaxSizeHint: "JSON up to tens of KB (effective/provenance)",
		publicFeature: true,
		targetClass: "B_advanced_user",
		migrationStrategy: "Keep mode select; move large policy_*_json to files with compact status.",
		largeJsonIds: [
			"global_modes.available_json",
			"global_modes.effective_profile_json",
			"policy.global.configured_json",
			"policy.global.effective_json",
			"policy.global.provenance_json",
		],
	},
	{
		id: "user_intent",
		label: "User Intent",
		idPattern: "user_intent.*",
		estimatedStaticCount: 40,
		dataTypes: ["string", "boolean", "number"],
		readWrite: "mixed",
		producer: "intent/ensure_states",
		consumers: ["intent engine", "VIS (partial)"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "resolved_*_json medium",
		publicFeature: true,
		targetClass: "B_advanced_user",
		migrationStrategy: "Keep domain request/result; collapse diagnostics JSON.",
		largeJsonIds: ["user_intent.*.resolved_json"],
	},
	{
		id: "planner_core",
		label: "Planner core intents / constraints",
		idPattern: "planner.* (excl. coordinator/authority/takeover/intent.forecast|daily|allocation|contributions|supply)",
		estimatedStaticCount: 16,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mostly_read",
		producer: "planner/ensure_states",
		consumers: ["operator constraints", "diagnose"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "planner.intent.last_json large",
		publicFeature: true,
		targetClass: "F_compatibility_contract",
		migrationStrategy:
			"Block 5: thermal/cooling/winter + surplus/deficit purged; Daily Plan / operator.diagnostics are control path.",
		largeJsonIds: ["planner.intent.last_json"],
	},
	{
		id: "planner_coordinator",
		label: "Planner coordinator + shadow comparison",
		idPattern: "planner.coordinator.*",
		estimatedStaticCount: 33,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "buttons",
		producer: "planner_shadow/ensure_states, status_bridge",
		consumers: ["shadow runtime", "admin/pilot"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "scalars / short strings",
		publicFeature: false,
		targetClass: "C_temporary_diagnostics",
		migrationStrategy:
			"Collapse to ~8 user-facing status fields; hide revision/comparison detail behind diagnostic mode; rename away from shadow/candidate.",
	},
	{
		id: "planner_authority",
		label: "Planner authority + memory RSS",
		idPattern: "planner.authority.*",
		estimatedStaticCount: 21,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "buttons",
		producer: "planner_authority/states (lazy)",
		consumers: ["authority runtime", "pilot"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "scalars",
		publicFeature: false,
		targetClass: "C_temporary_diagnostics",
		migrationStrategy: "Ensure only when worker_dryrun/pilot active; hide activate buttons from normal UI.",
	},
	{
		id: "planner_takeover",
		label: "Planner takeover evaluation",
		idPattern: "planner.takeover.* (excl. authorization)",
		estimatedStaticCount: 22,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mostly_read",
		producer: "planner_takeover/states",
		consumers: ["dual-run bridge", "pilot"],
		persistenceNeed: "file_preferred",
		avgOrMaxSizeHint: "scalars; evidence on disk",
		publicFeature: false,
		targetClass: "C_temporary_diagnostics",
		migrationStrategy: "Do not ensure when planner_runtime_mode=off; evidence stays in ems-runtime files.",
	},
	{
		id: "planner_authorization",
		label: "Takeover authorization (prepare/confirm)",
		idPattern: "planner.takeover.authorization.*",
		estimatedStaticCount: 23,
		dataTypes: ["string", "boolean", "number"],
		readWrite: "buttons",
		producer: "planner_authorization/states (lazy)",
		consumers: ["authorization service"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "scalars",
		publicFeature: false,
		targetClass: "C_temporary_diagnostics",
		migrationStrategy: "Lazy-only; never Core User Surface.",
	},
	{
		id: "forecast_plan",
		label: "Forecast plan",
		idPattern: "planner.intent.forecast_plan.*",
		estimatedStaticCount: 14,
		dataTypes: ["string", "number"],
		readWrite: "mostly_read",
		producer: "operator/forecast/states, tick",
		consumers: ["operator", "snapshot (excluded from hot path)"],
		persistenceNeed: "file_preferred",
		avgOrMaxSizeHint: "plan_json / slots_json / contributions_json often 10–200+ KB",
		publicFeature: false,
		targetClass: "D_internal_file_data",
		migrationStrategy:
			"Write to ems-runtime.<n>/planner/forecast/; keep status+generated_at+revision states only.",
		largeJsonIds: [
			"planner.intent.forecast_plan.plan_json",
			"planner.intent.forecast_plan.slots_json",
			"planner.intent.forecast_plan.days_json",
			"planner.intent.forecast_plan.contributions_json",
		],
	},
	{
		id: "daily_plan",
		label: "Daily plan",
		idPattern: "planner.intent.daily_plan.*",
		estimatedStaticCount: 17,
		dataTypes: ["string", "number"],
		readWrite: "mostly_read",
		producer: "operator/daily_plan/states, tick",
		consumers: ["addons daily_plan readers", "authority project_intent"],
		persistenceNeed: "file_preferred",
		avgOrMaxSizeHint: "plan_json / allocations_json large",
		publicFeature: false,
		targetClass: "D_internal_file_data",
		migrationStrategy:
			"Durable canonical already under ems.<n>/planner/; stop mirroring full JSON to states; keep compact status.",
		largeJsonIds: [
			"planner.intent.daily_plan.plan_json",
			"planner.intent.daily_plan.slots_json",
			"planner.intent.daily_plan.allocations_json",
			"planner.intent.daily_plan.unallocated_json",
			"planner.intent.daily_plan.policy_snapshot_json",
			"planner.intent.daily_plan.constraint_snapshot_json",
		],
	},
	{
		id: "allocations",
		label: "Per-addon allocation mirrors",
		idPattern: "planner.intent.allocation.<addon>.*",
		estimatedStaticCount: 12,
		dataTypes: ["string"],
		readWrite: "mostly_read",
		producer: "operator/daily_plan allocation writers",
		consumers: ["wallbox/battery/IH/AC daily_plan modules"],
		persistenceNeed: "file_preferred",
		avgOrMaxSizeHint: "plan_json per addon",
		publicFeature: false,
		targetClass: "F_compatibility_contract",
		migrationStrategy: "Replace plan_json with file path + compact status after addon readers migrate.",
		largeJsonIds: [
			"planner.intent.allocation.battery.plan_json",
			"planner.intent.allocation.wallbox.plan_json",
			"planner.intent.allocation.immersion_heater.plan_json",
			"planner.intent.allocation.air_conditioning.plan_json",
		],
	},
	{
		id: "contributions",
		label: "Flexible contributions",
		idPattern: "planner.intent.contributions.*",
		estimatedStaticCount: 23,
		dataTypes: ["string"],
		readWrite: "mostly_read",
		producer: "operator/contributions/flexible/states",
		consumers: ["forecast/daily builders"],
		persistenceNeed: "file_preferred",
		avgOrMaxSizeHint: "contributions_json medium–large",
		publicFeature: false,
		targetClass: "D_internal_file_data",
		migrationStrategy: "Move JSON blobs to runtime files; keep active/excluded counts.",
		largeJsonIds: [
			"planner.intent.contributions.flexible.contributions_json",
			"planner.intent.contributions.*.contributions_json",
		],
	},
	{
		id: "grid_supply",
		label: "Grid supply / house fuse exposure",
		idPattern: "planner.intent.supply.grid.*",
		estimatedStaticCount: 10,
		dataTypes: ["string", "number"],
		readWrite: "mostly_read",
		producer: "operator/supply/grid_states",
		consumers: ["operator"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "slots_json medium",
		publicFeature: true,
		targetClass: "B_advanced_user",
		migrationStrategy: "Keep max_import_power_w; move slots_json to file.",
		largeJsonIds: ["planner.intent.supply.grid.slots_json"],
	},
	{
		id: "learning",
		label: "Learning modules + persistence mirror",
		idPattern: "learning.*",
		estimatedStaticCount: 180,
		dynamicNote: "consumer_stats add 11×configured consumers",
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mostly_read",
		producer: "learning/*/ensure_states, persistence_mirror",
		consumers: ["learning ticks", "backup export"],
		persistenceNeed: "file_preferred",
		avgOrMaxSizeHint: "history/forecast JSON; persistence.*_json mirrors files",
		publicFeature: false,
		targetClass: "B_advanced_user",
		migrationStrategy:
			"Keep status+key scalars; stop dual-writing large JSON to states when files already exist under durable learning/.",
		largeJsonIds: [
			"learning.house_load.forecast_today_json",
			"learning.thermal_runtime.history_json",
			"learning.persistence.*_json",
		],
	},
	{
		id: "backup_restore",
		label: "Backup / restore / support / info.backup",
		idPattern: "backup.* | support.* | info.backup.*",
		estimatedStaticCount: 46,
		dataTypes: ["string", "boolean"],
		readWrite: "buttons",
		producer: "backup/ensure_states, backup_integration/ensure_states",
		consumers: ["admin operators", "migration"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "summary_json medium",
		publicFeature: true,
		targetClass: "B_advanced_user",
		migrationStrategy: "Keep buttons + status; expert-gate support diagnostics.",
	},
	{
		id: "wallbox",
		label: "Wallbox runtime / status / EVCC / mapping",
		idPattern: "addons.wallbox.* (excl. vehicles)",
		estimatedStaticCount: 200,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mixed",
		producer: "addons/wallbox/*ensure*",
		consumers: ["wallbox runtime", "EVCC"],
		persistenceNeed: "durable_state",
		avgOrMaxSizeHint: "several *_json mapping/dispatch blobs",
		publicFeature: true,
		targetClass: "A_core_user",
		migrationStrategy: "Keep operational status; expert-gate mapping matrices and dryrun JSON.",
		largeJsonIds: [
			"addons.wallbox.runtime.dispatch_intent_json",
			"addons.wallbox.runtime.write_plan_json",
			"addons.wallbox.status.evcc.snapshot_json",
			"addons.wallbox.status.ev_foundation.model_json",
			"addons.wallbox.status.ev_foundation.capabilities_json",
			"addons.wallbox.status.ev_foundation.external_smart_plan_json",
			"addons.wallbox.status.ev_foundation.external_raw_diagnostics_json",
		],
	},
	{
		id: "vehicle_profiles",
		label: "Wallbox vehicle profiles (removed)",
		idPattern: "addons.wallbox.vehicles.<vehicleId>.*",
		estimatedStaticCount: 0,
		dynamicNote: "removed v0.1.227 — use admin wb_vehicle_map (no state trees); orphans purged by surface cleanup",
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mixed",
		producer: "(removed)",
		consumers: [],
		persistenceNeed: "none",
		avgOrMaxSizeHint: "n/a",
		publicFeature: false,
		targetClass: "E_obsolete",
		migrationStrategy: "Purge addons.wallbox.vehicles.*; capacity/maxW via wb_vehicle_map + EVCC-first remaining energy.",
	},
	{
		id: "battery",
		label: "Battery addon + ems_mirror",
		idPattern: "addons.battery.* | ems_mirror.*",
		estimatedStaticCount: 140,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mixed",
		producer: "addons/battery/ensure_states, ems_mirror",
		consumers: ["battery runtime"],
		persistenceNeed: "durable_state",
		avgOrMaxSizeHint: "mostly scalars",
		publicFeature: true,
		targetClass: "A_core_user",
		migrationStrategy: "Keep telemetry/status; expert-gate mapping + dryrun trees.",
	},
	{
		id: "immersion_heater",
		label: "Immersion heater",
		idPattern: "addons.immersion_heater.*",
		estimatedStaticCount: 45,
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mixed",
		producer: "addons/immersion_heater/runtime/ensure_states",
		consumers: ["IH runtime"],
		persistenceNeed: "durable_state",
		avgOrMaxSizeHint: "snapshot_json medium",
		publicFeature: true,
		targetClass: "A_core_user",
		migrationStrategy: "Ensure only when addon enabled; expert-gate mapping.",
	},
	{
		id: "air_conditioning",
		label: "Air conditioning units + mappings",
		idPattern: "addons.air_conditioning.* | addons.climate.*",
		estimatedStaticCount: 120,
		dynamicNote:
			"Phase 4B1: only configured units (enabled OR mapping target). Unconfigured unit_2..5 placeholders are not ensured and may be cleaned.",
		dataTypes: ["string", "number", "boolean"],
		readWrite: "mixed",
		producer: "addons/air_conditioning/runtime/ensure_states",
		consumers: ["AC runtime"],
		persistenceNeed: "durable_state",
		avgOrMaxSizeHint: "mostly scalars",
		publicFeature: true,
		targetClass: "A_core_user",
		migrationStrategy:
			"Ensure only configured units; controlled cleanup allowlist for never-configured placeholders; keep disabled-but-configured.",
	},
	{
		id: "diagnostics_misc",
		label: "Dryrun mirrors and ad-hoc diagnostics",
		idPattern: "addons.<addon>.dryrun.*",
		estimatedStaticCount: 0,
		dynamicNote: "Created on first write (~14 suffixes × active dryrun addons)",
		dataTypes: ["string", "boolean"],
		readWrite: "mostly_read",
		producer: "dryrun_mirror",
		consumers: ["operators debugging live writes"],
		persistenceNeed: "session",
		avgOrMaxSizeHint: "small",
		publicFeature: false,
		targetClass: "C_temporary_diagnostics",
		migrationStrategy: "Create only in dryrun+diagnostic mode; auto-expire or omit from object tree for normal users.",
	},
];

export function summarizeStateSurfaceCatalog(): {
	familyCount: number;
	estimatedStaticTotal: number;
	byClass: Record<StateSurfaceClass, number>;
	largestFamilies: Array<{ id: string; estimatedStaticCount: number }>;
} {
	const byClass = {
		A_core_user: 0,
		B_advanced_user: 0,
		C_temporary_diagnostics: 0,
		D_internal_file_data: 0,
		E_obsolete: 0,
		F_compatibility_contract: 0,
	} as Record<StateSurfaceClass, number>;
	let estimatedStaticTotal = 0;
	for (const f of STATE_SURFACE_FAMILIES) {
		estimatedStaticTotal += f.estimatedStaticCount;
		byClass[f.targetClass] += f.estimatedStaticCount;
	}
	const largestFamilies = [...STATE_SURFACE_FAMILIES]
		.sort((a, b) => b.estimatedStaticCount - a.estimatedStaticCount)
		.slice(0, 8)
		.map((f) => ({ id: f.id, estimatedStaticCount: f.estimatedStaticCount }));
	return {
		familyCount: STATE_SURFACE_FAMILIES.length,
		estimatedStaticTotal,
		byClass,
		largestFamilies,
	};
}
