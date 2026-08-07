/** Maschinenlesbare Reason Codes — keine Freitextlogik im Allocator. */
export const REASON = {
	HOUSE_LOAD_REQUIRED: "house_load_required",
	VEHICLE_DEADLINE_REQUIRED: "vehicle_deadline_required",
	VEHICLE_PRESENCE_REQUIRED: "vehicle_presence_required",
	PV_SURPLUS_AVAILABLE: "pv_surplus_available",
	PV_EXPECTED_BEFORE_DEADLINE: "pv_expected_before_deadline",
	THERMAL_FLEX_AVAILABLE: "thermal_flex_available",
	BATTERY_SOC_TARGET: "battery_soc_target",
	BATTERY_RESERVE_PROTECTED: "battery_reserve_protected",
	GRID_IMPORT_COST_OPTIMAL: "grid_import_cost_optimal",
	GRID_IMPORT_CONSERVATIVE_DEADLINE: "grid_import_conservative_deadline",
	EXPORT_UNAVOIDABLE: "export_unavoidable",
	CLIMATE_FLEX: "climate_flex",
	OTHER_FLEX: "other_flex",
	MIN_POWER_SLOT: "min_power_slot",
} as const;

export type UnifiedReasonCode = (typeof REASON)[keyof typeof REASON];
