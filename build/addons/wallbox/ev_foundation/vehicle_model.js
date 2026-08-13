"use strict";
/**
 * Canonical vehicle-read path for later planner use (v0.1.272: diagnosis only).
 * EvModelV1 is the EVCC-first input. Legacy vehicle profiles stay available but
 * must not blanket-block foundation capability when missing.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.applyEvFoundationIntegration = exports.assessVehicleModelPath = void 0;
const evcc_config_1 = require("../evcc_config");
const evcc_control_config_1 = require("../evcc_control_config");
const evcc_mode_control_1 = require("../evcc_mode_control");
const config_1 = require("../vehicles/config");
/**
 * Foundation is usable as later planner input when EVCC telemetry is present.
 * Missing vehicle profiles do not force ready=false.
 */
function assessVehicleModelPath(input) {
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
exports.assessVehicleModelPath = assessVehicleModelPath;
/** Overlay control-contract and vehicle-path diagnosis onto EvModelV1. No planner decision. */
function applyEvFoundationIntegration(model, capabilities, adapterConfig) {
    const controlModel = (0, evcc_control_config_1.resolveWallboxControlModel)(adapterConfig);
    const contract = (0, evcc_mode_control_1.resolveEvccModeControlContract)(adapterConfig);
    const profiles = (0, config_1.wallboxVehicleProfilesConfigFromAdapter)(adapterConfig);
    const path = assessVehicleModelPath({
        capabilities,
        model,
        profileCount: profiles.profiles.length,
        profilePlanningReady: profiles.profiles.length > 0,
    });
    return {
        ...model,
        controlContractModel: (0, evcc_mode_control_1.controlContractModelFromVariant)(controlModel, contract.resolvedVariant),
        evccControlContractReady: controlModel === "evcc" && contract.writeContractReady,
        legacyDirectControlPresent: (0, evcc_config_1.hasLegacyWallboxWriteMapping)(adapterConfig),
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
exports.applyEvFoundationIntegration = applyEvFoundationIntegration;
