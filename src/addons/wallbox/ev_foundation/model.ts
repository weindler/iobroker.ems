import type { EvccTelemetrySnapshot } from "../evcc_telemetry";
import type { TelemetryField } from "../normalize";
import type { EvFoundationConfig } from "./config";
import { resolveEvPlanningHints } from "./config";
import type { EvCapabilities, EvDataQuality, EvFieldQuality, EvModelV1, EvModuleState } from "./types";
import { emptySmartPlanEval, type ExternalEvInformation } from "./external/types";
import { externalControlEnabledFromConfig } from "./external/quality";

function pick<T>(field: TelemetryField<T>): T | null {
	return field.status === "valid" ? field.value : null;
}

function fieldQuality(field: TelemetryField<unknown>): EvFieldQuality {
	if (field.status === "valid") return "valid";
	if (field.status === "invalid") return "invalid";
	return "unknown";
}

/**
 * Read-only mapping of EVCC loadpoint mode → prepared EV module state.
 * Does not implement transitions into external / ems_takeover / manual_override.
 */
export function derivePreparedEvModuleState(evccMode: string | null): EvModuleState {
	const mode = (evccMode ?? "").trim().toLowerCase();
	if (mode === "pv" || mode === "solar") return "pv";
	if (mode === "minpv" || mode === "min+pv" || mode === "min") return "minpv";
	if (mode === "now" || mode === "immediate") return "planned_now";
	return "idle";
}

export function resolveEvDataQuality(
	snap: EvccTelemetrySnapshot,
	caps: EvCapabilities,
): EvDataQuality {
	if (!caps.evccAvailable) return "unknown";
	const requiredInvalid =
		snap.connected.status === "invalid" ||
		snap.charging.status === "invalid" ||
		snap.charge_power_w.status === "invalid" ||
		snap.loadpoint_mode.status === "invalid";
	if (requiredInvalid) return "degraded";
	if (snap.connected.status === "valid" && snap.charging.status === "valid") return "ok";
	if (snap.connection.status === "valid" && snap.connection.value === true) return "ok";
	return "degraded";
}

export function buildEvModelV1(input: {
	snap: EvccTelemetrySnapshot;
	foundation: EvFoundationConfig;
	capabilities: EvCapabilities;
	adapterConfig: unknown;
	external?: ExternalEvInformation | null;
}): EvModelV1 {
	const { snap, foundation, capabilities, adapterConfig } = input;
	const external = input.external;
	const vehicleName = pick(snap.vehicle_name);
	const vehicleTitle = pick(snap.vehicle_title);
	const hints = resolveEvPlanningHints(adapterConfig, vehicleName, vehicleTitle);
	const evccMode = pick(snap.loadpoint_mode);
	const vehicleSocQuality = fieldQuality(snap.vehicle_soc_pct);
	const plan = external?.smartPlan ?? emptySmartPlanEval();
	const controlEnabled = externalControlEnabledFromConfig(foundation);

	return {
		evccConnected: pick(snap.connection),
		vehicleConnected: pick(snap.connected),
		charging: pick(snap.charging),
		chargePowerW: pick(snap.charge_power_w),
		evccMode,
		phasesConfigured: pick(snap.configured_phases),
		phasesActive: pick(snap.active_phases),
		maxCurrentA: pick(snap.max_current_a),
		minCurrentA: pick(snap.min_current_a),
		vehicleSocPct: vehicleSocQuality === "valid" ? pick(snap.vehicle_soc_pct) : null,
		targetSocPct: foundation.targetSocPct ?? external?.externalTargetSocPct ?? null,
		minimumDepartureSocPct: foundation.minimumDepartureSocPct,
		departureAt: foundation.departureAt,
		batteryCapacityKWh: hints.batteryCapacityKWh,
		maxAcChargePowerKw: hints.maxAcChargePowerKw,
		chargingEfficiency: foundation.chargingEfficiency,
		safetyMarginMin: foundation.safetyMarginMin,
		vehicleAvailableUntil: foundation.vehicleAvailableUntil,
		externalControlEnabled: controlEnabled,
		externalControlType: foundation.externalControlType,
		externalControlActive: external?.externalControlActive ?? null,
		externalControlConfigured: external?.externalControlConfigured === true,
		externalSmartPlanAvailable: plan.validPlanPresent,
		externalSmartPlanSlots: plan.mappingConfigured ? plan.slots : null,
		externalPlanRemainingEnergyKWh: plan.remainingEnergyKWh,
		externalPlanRemainingMinutes: plan.remainingMinutes,
		externalPlanDeadlineUsed: plan.deadlineUsed,
		gridRewardsActive: external?.gridRewardsActive ?? null,
		smartChargingActive: external?.smartChargingActive ?? null,
		externalSourceQuality: external?.externalSourceQuality ?? "unconfigured",
		externalSourceUpdatedAt: external?.externalSourceUpdatedAt ?? null,
		externalSourceHealthy: external?.externalSourceHealthy ?? true,
		manualOverrideActive: null,
		emsTakeoverActive: false,
		preparedEvState: derivePreparedEvModuleState(evccMode),
		takeoverReason: null,
		vehicleDetectionActive: pick(snap.vehicle_detection_active),
		dataQuality: resolveEvDataQuality(snap, capabilities),
		vehicleSocQuality,
		externalSmartChargingMinSocPct: external?.externalSmartChargingMinSocPct ?? null,
		externalSmartChargingMinSocQuality: external?.externalSmartChargingMinSocQuality ?? "unconfigured",
		departureMinSocConfigured: foundation.minimumDepartureSocPct !== null,
		vehicleModelSource: "none",
		vehicleModelReady: false,
		controlContractModel: "none",
		evccControlContractReady: false,
		legacyDirectControlPresent: false,
	};
}
