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
    const c = adapterConfig && typeof adapterConfig === "object" ? adapterConfig : {};
    const controlModel = (0, evcc_control_config_1.resolveWallboxControlModel)(adapterConfig);
    const contract = (0, evcc_control_config_1.resolveEvccControlContractV1)(adapterConfig);
    const stringModeComplete = (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_mode").length > 0 &&
        (0, evcc_control_config_1.evccControlTargetForRole)(c, "set_max_current_a").length > 0 &&
        (0, evcc_control_config_1.evccModeChargeValue)(c).length > 0;
    const profiles = (0, config_1.wallboxVehicleProfilesConfigFromAdapter)(adapterConfig);
    const path = assessVehicleModelPath({
        capabilities,
        model,
        profileCount: profiles.profiles.length,
        profilePlanningReady: profiles.profiles.length > 0,
    });
    return {
        ...model,
        controlContractModel: (0, evcc_control_config_1.resolveControlContractModel)(controlModel, contract.ready, stringModeComplete),
        evccControlContractReady: controlModel === "evcc" && contract.ready,
        legacyDirectControlPresent: (0, evcc_config_1.hasLegacyWallboxWriteMapping)(adapterConfig),
        vehicleModelSource: path.source,
        vehicleModelReady: path.ready,
    };
}
exports.applyEvFoundationIntegration = applyEvFoundationIntegration;
