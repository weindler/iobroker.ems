/**
 * Kern-State-Vertrag für Cold-Start-/Recovery-Tests.
 * Kein vollständiger Objektbaum-Snapshot — nur unabhängig prüfbare Kategorien.
 */

export const BOOTSTRAP_CORE_STATE_CATEGORIES = {
	globalBasis: [
		"global.execution_mode",
		"command.inbox",
		"command.last_result",
		"audit.last_event",
	],
	executionSafety: ["execution.safety.global_execution_mode", "execution.safety.summary_de"],
	addonExecution: [
		"addons.wallbox.mode",
		"addons.battery.mode",
		"addons.immersion_heater.mode",
		"addons.air_conditioning.mode",
	],
	addonBasis: [
		"addons.wallbox.enabled",
		"addons.battery.enabled",
		"addons.immersion_heater.enabled",
		"addons.air_conditioning.enabled",
	],
	emsLightBasis: ["system.version", "system.mode", "system.health"],
	globalModes: ["global_modes.requested", "global_modes.active", "global_modes.revision"],
	policyBasis: [
		"policy.system.revision",
		"policy.system.status",
		"policy.global.revision",
		"policy.global.status",
	],
	intentBasis: ["user_intent.wallbox.resolved_json", "user_intent.thermal.resolved_json"],
	plannerBasis: ["planner.status", "planner.intent.daily_plan.revision"],
	batteryBasis: ["addons.battery.telemetry.soc_pct", "addons.battery.status.state"],
	wallboxBasis: [
		"addons.wallbox.status.evcc.connected",
		"addons.wallbox.runtime.decision_source",
		"addons.wallbox.runtime.fault_active",
	],
	immersionBasis: ["addons.immersion_heater.runtime.state"],
	learningPersistence: ["learning.persistence.last_mirror"],
} as const;

export type BootstrapCoreCategory = keyof typeof BOOTSTRAP_CORE_STATE_CATEGORIES;

/** Flache Liste aller Kern-IDs für Assertions. */
export function allBootstrapCoreStateIds(): string[] {
	return Object.values(BOOTSTRAP_CORE_STATE_CATEGORIES).flat();
}

/** Legacy-Fahrzeugslot-Präfixe — dürfen nach Cold Start nicht existieren. */
export const LEGACY_WALLBOX_VEHICLE_SLOT_PREFIXES = [
	"addons.wallbox.vehicles.wb_vehicle_1_",
	"addons.wallbox.vehicles.wb_vehicle_2_",
	"addons.wallbox.vehicles.wb_vehicle_3_",
	"addons.wallbox.vehicles.wb_vehicle_4_",
] as const;
