"use strict";
/** Wallbox vehicle profile foundation (v0.1.138) — read-only / diagnostic. */
Object.defineProperty(exports, "__esModule", { value: true });
exports.VEHICLE_REASON_CODES = void 0;
exports.VEHICLE_REASON_CODES = {
    profileMissing: "vehicle_profile_missing",
    profileDisabled: "vehicle_profile_disabled",
    profileInvalid: "vehicle_profile_invalid",
    idInvalid: "vehicle_id_invalid",
    resolutionAmbiguous: "vehicle_resolution_ambiguous",
    notConnected: "vehicle_not_connected",
    socUnavailable: "vehicle_soc_unavailable",
    capacityUnavailable: "vehicle_capacity_unavailable",
    chargeLimitsUnavailable: "vehicle_charge_limits_unavailable",
    targetSocUnavailable: "vehicle_target_soc_unavailable",
    evccMappingMissing: "vehicle_evcc_mapping_missing",
    manualSelectionInvalid: "vehicle_manual_selection_invalid",
    unknown: "vehicle_unknown",
    guestExplicit: "vehicle_guest_explicit",
    singleEnabledProfile: "vehicle_single_enabled_profile",
    evccMatch: "vehicle_evcc_match",
    manualMatch: "vehicle_manual_match",
    disconnected: "vehicle_disconnected",
};
