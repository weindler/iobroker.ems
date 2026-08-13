import type { EvccTelemetrySnapshot } from "../evcc_telemetry";
import type { WallboxEvccTelemetryConfig } from "../evcc_config";
import type { EvCapabilities } from "./types";
import { EMPTY_EV_CAPABILITIES } from "./types";
import type { EvFoundationConfig } from "./config";
import type { ExternalEvInformation } from "./external/types";

function mapped(id: string): boolean {
	return id.trim().length > 0;
}

function valid(field: { status: string }): boolean {
	return field.status === "valid";
}

export function resolveEvCapabilities(
	telemetryCfg: WallboxEvccTelemetryConfig,
	snap: EvccTelemetrySnapshot,
	foundation: EvFoundationConfig,
	external?: ExternalEvInformation | null,
): EvCapabilities {
	if (!foundation.evccIntegrationEnabled) {
		return { ...EMPTY_EV_CAPABILITIES };
	}

	const connectionKnown = valid(snap.connection);
	const anyRequiredValid =
		valid(snap.connected) ||
		valid(snap.charging) ||
		valid(snap.charge_power_w) ||
		valid(snap.loadpoint_mode) ||
		valid(snap.max_current_a);
	const evccAvailable =
		(connectionKnown && snap.connection.value === true) ||
		(!connectionKnown && anyRequiredValid);

	const liveFromTelemetry =
		valid(snap.vehicle_range_km) ||
		valid(snap.vehicle_odometer_km) ||
		valid(snap.vehicle_name) ||
		valid(snap.vehicle_title);

	const externalControlDetectable =
		foundation.externalControlType !== "none" ||
		foundation.tibberGridRewardsViaVehicleEnabled ||
		foundation.tibberGridRewardsViaWallboxEnabled ||
		mapped(foundation.externalControlActiveStateId) ||
		mapped(foundation.externalGridRewardsActiveStateId) ||
		mapped(foundation.holdSignals.tibberGridRewardsActiveStateId);

	const externalSmartPlanAvailable = external?.smartPlan.validPlanPresent === true;

	return {
		evccAvailable,
		vehicleSocAvailable: mapped(telemetryCfg.vehicleSocStateId) && valid(snap.vehicle_soc_pct),
		vehicleConnectedAvailable: mapped(telemetryCfg.connectedStateId) && valid(snap.connected),
		chargePowerAvailable: mapped(telemetryCfg.chargePowerWStateId) && valid(snap.charge_power_w),
		realChargePhaseAvailable: mapped(telemetryCfg.activePhasesStateId) && valid(snap.active_phases),
		vehicleLiveDataAvailable: foundation.vehicleLiveDataAvailable || liveFromTelemetry,
		externalControlDetectable,
		externalSmartPlanAvailable,
		tibberGridRewardsViaVehicle: foundation.tibberGridRewardsViaVehicleEnabled,
		tibberGridRewardsViaWallbox: foundation.tibberGridRewardsViaWallboxEnabled,
		homeAssistantDataSourceAvailable: foundation.homeAssistantDataSourceEnabled,
		externalControlConfigured: external?.externalControlConfigured === true,
	};
}
