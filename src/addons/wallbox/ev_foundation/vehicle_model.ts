/**
 * Canonical vehicle-read path for later planner use (v0.1.272: diagnosis only).
 * EvModelV1 is the EVCC-first input. Legacy vehicle profiles stay available but
 * must not blanket-block foundation capability when missing.
 */

import { hasLegacyWallboxWriteMapping } from "../evcc_config";
import { resolveWallboxControlModel } from "../evcc_control_config";
import { controlContractModelFromVariant, resolveEvccModeControlContract } from "../evcc_mode_control";
import { wallboxVehicleProfilesConfigFromAdapter } from "../vehicles/config";
import type { EvCapabilities, EvModelV1 } from "./types";

export type VehicleModelSource = EvModelV1["vehicleModelSource"];

export interface VehicleModelPathInput {
	capabilities: EvCapabilities;
	model: Pick<
		EvModelV1,
		"vehicleConnected" | "vehicleSocPct" | "batteryCapacityKWh" | "maxAcChargePowerKw" | "dataQuality"
	>;
	profileCount: number;
	profilePlanningReady: boolean;
}

export interface VehicleModelPath {
	source: VehicleModelSource;
	ready: boolean;
}

/**
 * Foundation is usable as later planner input when EVCC telemetry is present.
 * Missing vehicle profiles do not force ready=false.
 */
export function assessVehicleModelPath(input: VehicleModelPathInput): VehicleModelPath {
	const foundationUsable = input.capabilities.evccAvailable && input.model.dataQuality !== "unknown";
	const profileReady = input.profileCount > 0 && input.profilePlanningReady;

	if (foundationUsable && profileReady) {
		return { source: "conflict", ready: true };
	}
	if (foundationUsable) {
		return { source: "ev_model_v1", ready: true };
	}
	if (profileReady) {
		return { source: "vehicle_profile", ready: true };
	}
	return { source: "none", ready: false };
}

/** Overlay control-contract and vehicle-path diagnosis onto EvModelV1. No planner decision. */
export function applyEvFoundationIntegration(
	model: EvModelV1,
	capabilities: EvCapabilities,
	adapterConfig: unknown,
): EvModelV1 {
	const controlModel = resolveWallboxControlModel(adapterConfig);
	const contract = resolveEvccModeControlContract(adapterConfig);
	const profiles = wallboxVehicleProfilesConfigFromAdapter(adapterConfig);
	const path = assessVehicleModelPath({
		capabilities,
		model,
		profileCount: profiles.profiles.length,
		profilePlanningReady: profiles.profiles.length > 0,
	});
	return {
		...model,
		controlContractModel: controlContractModelFromVariant(controlModel, contract.resolvedVariant),
		evccControlContractReady: controlModel === "evcc" && contract.writeContractReady,
		legacyDirectControlPresent: hasLegacyWallboxWriteMapping(adapterConfig),
		evccModeControlVariant: controlModel === "evcc" ? contract.resolvedVariant : "none",
		evccModeFeedbackState: contract.modeFeedbackStateId,
		evccModeButtonsReady: controlModel === "evcc" && contract.buttonsReady,
		evccModeOffTargetReady: contract.buttonReady.off,
		evccModePvTargetReady: contract.buttonReady.pv,
		evccModeMinTargetReady: contract.buttonReady.min,
		evccModeNowTargetReady: contract.buttonReady.now,
		vehicleModelSource: path.source,
		vehicleModelReady: path.ready,
	};
}
