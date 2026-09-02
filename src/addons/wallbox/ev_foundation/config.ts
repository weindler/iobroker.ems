/**
 * EV-foundation admin config — extends existing Wallbox/EVCC keys, no parallel addon.
 */

import { intentAdminConfigFromAdapter } from "../../../intent/config";
import {
	wallboxHoldSignalConfigFromAdapter,
	type WallboxHoldSignalConfig,
	WB_TIBBER_GRID_REWARDS_ACTIVE,
	WB_EXTERNAL_VEHICLE_CHARGE,
} from "../evcc_config";
import { lookupVehicleMapEntry } from "../vehicle_map/lookup";
import { wallboxVehicleMapFromAdapter } from "../vehicle_map/config";
import type { EvExternalControlType } from "./types";
import { EV_EXTERNAL_CONTROL_TYPES } from "./types";

export const WB_EVCC_INTEGRATION_ENABLED = "wb_evcc_integration_enabled";
export const WB_TIBBER_GRID_REWARDS_VEHICLE_ENABLED = "wb_tibber_grid_rewards_vehicle_enabled";
export const WB_TIBBER_GRID_REWARDS_WALLBOX_ENABLED = "wb_tibber_grid_rewards_wallbox_enabled";
export const WB_VEHICLE_LIVE_DATA_AVAILABLE = "wb_vehicle_live_data_available";
export const WB_EXTERNAL_SMART_PLAN_AVAILABLE = "wb_external_smart_plan_available";
export const WB_EXTERNAL_CONTROL_TYPE = "wb_external_control_type";
export const WB_EV_TARGET_SOC_PCT = "wb_ev_target_soc_pct";
export const WB_EV_MINIMUM_DEPARTURE_SOC_PCT = "wb_ev_minimum_departure_soc_pct";
export const WB_EV_BATTERY_CAPACITY_KWH = "wb_ev_battery_capacity_kwh";
export const WB_EV_MAX_AC_CHARGE_POWER_KW = "wb_ev_max_ac_charge_power_kw";
export const WB_EV_CHARGING_EFFICIENCY = "wb_ev_charging_efficiency";
export const WB_EV_SAFETY_MARGIN_MIN = "wb_ev_safety_margin_min";
export const WB_EV_DEPARTURE_AT = "wb_ev_departure_at";
export const WB_EV_AVAILABLE_UNTIL = "wb_ev_available_until";
export const WB_HA_DATA_SOURCE_ENABLED = "wb_ha_data_source_enabled";
export const WB_EXTERNAL_SMART_PLAN_STATE = "wb_external_smart_plan_state";
export const WB_EXTERNAL_CONTROL_ACTIVE_STATE = "wb_external_control_active_state";
export const WB_EXTERNAL_GRID_REWARDS_ACTIVE_STATE = "wb_external_grid_rewards_active_state";
export const WB_EXTERNAL_SMART_PLAN_ENABLED_STATE = "wb_external_smart_plan_enabled_state";
export const WB_EXTERNAL_SMART_CHARGING_STATUS_STATE = "wb_external_smart_charging_status_state";
export const WB_EXTERNAL_PLAN_DEADLINE_STATE = "wb_external_plan_deadline_state";
export const WB_EXTERNAL_TARGET_SOC_STATE = "wb_external_target_soc_state";
export const WB_EXTERNAL_SMART_PLAN_START_STATE = "wb_external_smart_plan_start_state";
export const WB_EXTERNAL_SMART_PLAN_END_STATE = "wb_external_smart_plan_end_state";
export const WB_VEHICLE_CHARGE_PAUSE_STATE = "wb_vehicle_charge_pause_state";
export const WB_EXTERNAL_SOURCE_STALE_AFTER_MIN = "wb_external_source_stale_after_min";
export const WB_EXTERNAL_SOURCE_UPDATED_AT_STATE = "wb_external_source_updated_at_state";
export const WB_EXTERNAL_SMART_CHARGING_MIN_SOC_STATE = "wb_external_smart_charging_min_soc_state";
export const WB_TIBBER_NOW_STABILIZE_SECONDS = "wb_tibber_now_stabilize_seconds";

export interface EvFoundationConfig {
	evccIntegrationEnabled: boolean;
	tibberGridRewardsViaVehicleEnabled: boolean;
	tibberGridRewardsViaWallboxEnabled: boolean;
	vehicleLiveDataAvailable: boolean;
	externalSmartPlanAvailable: boolean;
	externalControlType: EvExternalControlType;
	targetSocPct: number | null;
	minimumDepartureSocPct: number | null;
	batteryCapacityKWh: number | null;
	maxAcChargePowerKw: number | null;
	chargingEfficiency: number | null;
	safetyMarginMin: number | null;
	departureAt: string | null;
	vehicleAvailableUntil: string | null;
	homeAssistantDataSourceEnabled: boolean;
	externalSmartPlanStateId: string;
	externalControlActiveStateId: string;
	externalGridRewardsActiveStateId: string;
	externalSmartPlanEnabledStateId: string;
	externalSmartChargingStatusStateId: string;
	externalPlanDeadlineStateId: string;
	externalTargetSocStateId: string;
	externalSmartPlanStartStateId: string;
	externalSmartPlanEndStateId: string;
	vehicleChargePauseStateId: string;
	externalSourceStaleAfterMin: number;
	externalSourceUpdatedAtStateId: string;
	externalSmartChargingMinSocStateId: string;
	holdSignals: WallboxHoldSignalConfig;
	/** Wartezeit nach Anstecken, bevor Tibber-Schnell (now) gesetzt wird. */
	tibberNowStabilizeSeconds: number;
}

function strField(c: Record<string, unknown>, key: string): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : "";
}

function boolField(c: Record<string, unknown>, key: string, defaultVal: boolean): boolean {
	const v = c[key];
	if (v === true || v === 1 || v === "1" || v === "true") return true;
	if (v === false || v === 0 || v === "0" || v === "false") return false;
	return defaultVal;
}

/** Empty / whitespace / NaN → null. Never invents 0. */
export function parseOptionalAdminNumber(raw: unknown): number | null {
	if (raw === null || raw === undefined) return null;
	if (typeof raw === "boolean") return null;
	if (typeof raw === "string") {
		const s = raw.trim();
		if (!s) return null;
		const n = parseFloat(s.replace(",", "."));
		return Number.isFinite(n) ? n : null;
	}
	if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
	return null;
}

function optionalNumber(c: Record<string, unknown>, key: string): number | null {
	return parseOptionalAdminNumber(c[key]);
}

function optionalString(c: Record<string, unknown>, key: string): string | null {
	const s = strField(c, key);
	return s ? s : null;
}

function parseExternalControlType(raw: unknown): EvExternalControlType {
	const s = String(raw ?? "none").trim().toLowerCase();
	if ((EV_EXTERNAL_CONTROL_TYPES as readonly string[]).includes(s)) {
		return s as EvExternalControlType;
	}
	return "none";
}

/** Efficiency: 0.5–1.0 as fraction; 50–100 as percent. Never invent a default. */
export function normalizeChargingEfficiency(raw: number | null): number | null {
	if (raw === null || !Number.isFinite(raw)) return null;
	if (raw > 1 && raw <= 100) return raw / 100;
	if (raw >= 0.5 && raw <= 1) return raw;
	return null;
}

function clampSoc(raw: number | null): number | null {
	if (raw === null || !Number.isFinite(raw)) return null;
	if (raw < 0 || raw > 100) return null;
	return raw;
}

export function evFoundationConfigFromAdapter(config: unknown): EvFoundationConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const intentAdmin = intentAdminConfigFromAdapter(c);
	const mappedCapacity = optionalNumber(c, WB_EV_BATTERY_CAPACITY_KWH);
	const mappedMaxAcKw = optionalNumber(c, WB_EV_MAX_AC_CHARGE_POWER_KW);
	const targetFromIntent = intentAdmin.defaultTargetSocPct;
	return {
		evccIntegrationEnabled: boolField(c, WB_EVCC_INTEGRATION_ENABLED, true),
		tibberGridRewardsViaVehicleEnabled: boolField(c, WB_TIBBER_GRID_REWARDS_VEHICLE_ENABLED, false),
		tibberGridRewardsViaWallboxEnabled: boolField(c, WB_TIBBER_GRID_REWARDS_WALLBOX_ENABLED, false),
		vehicleLiveDataAvailable: boolField(c, WB_VEHICLE_LIVE_DATA_AVAILABLE, false),
		externalSmartPlanAvailable: boolField(c, WB_EXTERNAL_SMART_PLAN_AVAILABLE, false),
		externalControlType: parseExternalControlType(c[WB_EXTERNAL_CONTROL_TYPE]),
		targetSocPct: clampSoc(optionalNumber(c, WB_EV_TARGET_SOC_PCT) ?? targetFromIntent),
		minimumDepartureSocPct: clampSoc(optionalNumber(c, WB_EV_MINIMUM_DEPARTURE_SOC_PCT)),
		batteryCapacityKWh: mappedCapacity !== null && mappedCapacity > 0 ? mappedCapacity : null,
		maxAcChargePowerKw: mappedMaxAcKw !== null && mappedMaxAcKw > 0 ? mappedMaxAcKw : null,
		chargingEfficiency: normalizeChargingEfficiency(optionalNumber(c, WB_EV_CHARGING_EFFICIENCY)),
		safetyMarginMin: (() => {
			const n = optionalNumber(c, WB_EV_SAFETY_MARGIN_MIN);
			return n !== null && n >= 0 ? n : null;
		})(),
		departureAt: optionalString(c, WB_EV_DEPARTURE_AT),
		vehicleAvailableUntil: optionalString(c, WB_EV_AVAILABLE_UNTIL),
		homeAssistantDataSourceEnabled: boolField(c, WB_HA_DATA_SOURCE_ENABLED, false),
		externalSmartPlanStateId: strField(c, WB_EXTERNAL_SMART_PLAN_STATE),
		externalControlActiveStateId: strField(c, WB_EXTERNAL_CONTROL_ACTIVE_STATE),
		externalGridRewardsActiveStateId:
			strField(c, WB_EXTERNAL_GRID_REWARDS_ACTIVE_STATE) || strField(c, WB_TIBBER_GRID_REWARDS_ACTIVE),
		externalSmartPlanEnabledStateId: strField(c, WB_EXTERNAL_SMART_PLAN_ENABLED_STATE),
		externalSmartChargingStatusStateId: strField(c, WB_EXTERNAL_SMART_CHARGING_STATUS_STATE),
		externalPlanDeadlineStateId: strField(c, WB_EXTERNAL_PLAN_DEADLINE_STATE),
		externalTargetSocStateId: strField(c, WB_EXTERNAL_TARGET_SOC_STATE),
		externalSmartPlanStartStateId: strField(c, WB_EXTERNAL_SMART_PLAN_START_STATE),
		externalSmartPlanEndStateId: strField(c, WB_EXTERNAL_SMART_PLAN_END_STATE),
		vehicleChargePauseStateId:
			strField(c, WB_VEHICLE_CHARGE_PAUSE_STATE) || strField(c, WB_EXTERNAL_VEHICLE_CHARGE),
		externalSourceStaleAfterMin: (() => {
			const n = optionalNumber(c, WB_EXTERNAL_SOURCE_STALE_AFTER_MIN);
			return n !== null && n > 0 ? n : 30;
		})(),
		externalSourceUpdatedAtStateId: strField(c, WB_EXTERNAL_SOURCE_UPDATED_AT_STATE),
		externalSmartChargingMinSocStateId: strField(c, WB_EXTERNAL_SMART_CHARGING_MIN_SOC_STATE),
		holdSignals: wallboxHoldSignalConfigFromAdapter(c),
		tibberNowStabilizeSeconds: (() => {
			const n = optionalNumber(c, WB_TIBBER_NOW_STABILIZE_SECONDS);
			if (n === null) return 180;
			return Math.max(30, Math.min(900, Math.round(n)));
		})(),
	};
}

export function configuredExternalSourceStateIds(cfg: EvFoundationConfig): string[] {
	const ids = [
		cfg.externalSmartPlanStateId,
		cfg.externalControlActiveStateId,
		cfg.externalGridRewardsActiveStateId,
		cfg.externalSmartPlanEnabledStateId,
		cfg.externalSmartChargingStatusStateId,
		cfg.externalPlanDeadlineStateId,
		cfg.externalTargetSocStateId,
		cfg.externalSmartPlanStartStateId,
		cfg.externalSmartPlanEndStateId,
		cfg.vehicleChargePauseStateId,
		cfg.externalSourceUpdatedAtStateId,
		cfg.externalSmartChargingMinSocStateId,
	];
	return [...new Set(ids.filter((id) => id.trim().length > 0))];
}

/**
 * Capacity / max AC from foundation config, else vehicle mini-map match, else null.
 * Never invents values when map and config are empty.
 */
export function resolveEvPlanningHints(
	config: unknown,
	vehicleName: string | null,
	vehicleTitle: string | null,
): { batteryCapacityKWh: number | null; maxAcChargePowerKw: number | null } {
	const cfg = evFoundationConfigFromAdapter(config);
	let capacity = cfg.batteryCapacityKWh;
	let maxAcKw = cfg.maxAcChargePowerKw;
	if (capacity !== null && maxAcKw !== null) {
		return { batteryCapacityKWh: capacity, maxAcChargePowerKw: maxAcKw };
	}
	const map = wallboxVehicleMapFromAdapter(config);
	const entry = lookupVehicleMapEntry(map.entries, vehicleName, vehicleTitle);
	if (capacity === null && entry?.batteryCapacityNetKwh != null) {
		capacity = entry.batteryCapacityNetKwh;
	}
	if (maxAcKw === null && entry?.maxAcChargePowerW != null && entry.maxAcChargePowerW > 0) {
		maxAcKw = entry.maxAcChargePowerW / 1000;
	}
	return { batteryCapacityKWh: capacity, maxAcChargePowerKw: maxAcKw };
}
