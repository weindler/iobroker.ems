import type { WallboxVehicleProfile } from "./types";
import { sanitizeVehicleId } from "./vehicle_id";

export const WB_VEHICLE_PROFILES = "wb_vehicle_profiles";
export const WB_MANUAL_VEHICLE_ID = "wb_manual_vehicle_id";
export const WB_EVCC_VEHICLE_ID_STATE = "wb_evcc_vehicle_id_state";
export const WB_EVCC_VEHICLE_NAME_STATE = "wb_evcc_vehicle_name_state";

export interface WallboxVehicleProfilesConfig {
	manualVehicleId: string | null;
	evccVehicleIdStateId: string;
	evccVehicleNameStateId: string;
	profiles: WallboxVehicleProfileInput[];
}

export interface WallboxVehicleProfileInput {
	slotIndex: number;
	vehicleId: unknown;
	displayName: unknown;
	enabled: unknown;
	isGuest: unknown;
	source: unknown;
	evccVehicleId: unknown;
	evccVehicleName: unknown;
	batteryCapacityNetKwh: unknown;
	maxAcChargePowerW: unknown;
	supportedPhases: unknown;
	preferredPhases: unknown;
	minCurrentA: unknown;
	maxCurrentA: unknown;
	defaultTargetSocPct: unknown;
	minimumDepartureSocPct: unknown;
	maximumSocPct: unknown;
	chargeEfficiencyPct: unknown;
	socState: unknown;
	rangeState: unknown;
	connectedState: unknown;
	chargingState: unknown;
	sessionEnergyState: unknown;
}

function strField(c: Record<string, unknown>, key: string): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : "";
}

function rowHasVehicleId(row: Record<string, unknown>): boolean {
	const raw = row.vehicle_id;
	if (raw === null || raw === undefined) return false;
	return String(raw).trim().length > 0;
}

function profileInputFromRow(row: Record<string, unknown>, index: number): WallboxVehicleProfileInput {
	return {
		slotIndex: index,
		vehicleId: row.vehicle_id,
		displayName: row.display_name,
		enabled: row.enabled,
		isGuest: row.is_guest,
		source: row.source,
		evccVehicleId: row.evcc_vehicle_id,
		evccVehicleName: row.evcc_vehicle_name,
		batteryCapacityNetKwh: row.battery_capacity_net_kwh,
		maxAcChargePowerW: row.max_ac_charge_power_w,
		supportedPhases: row.supported_phases,
		preferredPhases: row.preferred_phases,
		minCurrentA: row.min_current_a,
		maxCurrentA: row.max_current_a,
		defaultTargetSocPct: row.default_target_soc_pct,
		minimumDepartureSocPct: row.minimum_departure_soc_pct,
		maximumSocPct: row.maximum_soc_pct,
		chargeEfficiencyPct: row.charge_efficiency_pct,
		socState: row.soc_state,
		rangeState: row.range_state,
		connectedState: row.connected_state,
		chargingState: row.charging_state,
		sessionEnergyState: row.session_energy_state,
	};
}

function parseProfileRows(raw: unknown): WallboxVehicleProfileInput[] {
	if (!Array.isArray(raw)) return [];
	const profiles: WallboxVehicleProfileInput[] = [];
	let index = 0;
	for (const entry of raw) {
		if (!entry || typeof entry !== "object") continue;
		const row = entry as Record<string, unknown>;
		if (!rowHasVehicleId(row)) continue;
		index += 1;
		profiles.push(profileInputFromRow(row, index));
	}
	return profiles;
}

export function wallboxVehicleProfilesConfigFromAdapter(config: unknown): WallboxVehicleProfilesConfig {
	const c = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const manualRaw = strField(c, WB_MANUAL_VEHICLE_ID);
	const manualSanitized = manualRaw ? sanitizeVehicleId(manualRaw) : null;
	return {
		manualVehicleId: manualSanitized?.valid ? manualSanitized.id : manualRaw || null,
		evccVehicleIdStateId: strField(c, WB_EVCC_VEHICLE_ID_STATE),
		evccVehicleNameStateId: strField(c, WB_EVCC_VEHICLE_NAME_STATE),
		profiles: parseProfileRows(c[WB_VEHICLE_PROFILES]),
	};
}

export function configuredVehicleTelemetryStateIds(profiles: WallboxVehicleProfile[]): string[] {
	const ids = new Set<string>();
	for (const p of profiles) {
		for (const id of [
			p.socStateId,
			p.rangeStateId,
			p.connectedStateId,
			p.chargingStateId,
			p.sessionEnergyStateId,
		]) {
			if (id) ids.add(id);
		}
	}
	return [...ids];
}

export function configuredVehicleDetectionStateIds(cfg: WallboxVehicleProfilesConfig): string[] {
	const ids: string[] = [];
	if (cfg.evccVehicleIdStateId) ids.push(cfg.evccVehicleIdStateId);
	if (cfg.evccVehicleNameStateId) ids.push(cfg.evccVehicleNameStateId);
	return ids;
}
