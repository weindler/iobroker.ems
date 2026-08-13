"use strict";
/**
 * Neutral EV data model V1 (Phase 1 foundation).
 * Planner later consumes these fields and capabilities only — never Ford/Tibber/HA state IDs.
 * No takeover / external-control transition logic in this phase.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMPTY_EV_CAPABILITIES = exports.EV_PHASE1_PREPARED_STATES = exports.EV_FIELD_QUALITY = exports.EV_DATA_QUALITY = exports.EV_EXTERNAL_CONTROL_TYPES = exports.EV_TAKEOVER_REASONS = exports.EV_MODULE_STATES = void 0;
exports.EV_MODULE_STATES = [
    "idle",
    "pv",
    "minpv",
    "planned_now",
    "external",
    "ems_takeover",
    "manual_override",
];
exports.EV_TAKEOVER_REASONS = [
    "deadline_risk",
    "insufficient_external_plan",
    "economic_window_loss",
    "external_unavailable",
];
exports.EV_EXTERNAL_CONTROL_TYPES = ["none", "vehicle", "wallbox", "unknown"];
exports.EV_DATA_QUALITY = ["ok", "degraded", "unknown"];
exports.EV_FIELD_QUALITY = ["valid", "unknown", "invalid"];
/** Prepared module states that Phase 1 may emit (read-only mapping from EVCC mode). */
exports.EV_PHASE1_PREPARED_STATES = ["idle", "pv", "minpv", "planned_now"];
exports.EMPTY_EV_CAPABILITIES = {
    evccAvailable: false,
    vehicleSocAvailable: false,
    vehicleConnectedAvailable: false,
    chargePowerAvailable: false,
    realChargePhaseAvailable: false,
    vehicleLiveDataAvailable: false,
    externalControlDetectable: false,
    externalSmartPlanAvailable: false,
    tibberGridRewardsViaVehicle: false,
    tibberGridRewardsViaWallbox: false,
    homeAssistantDataSourceAvailable: false,
    externalControlConfigured: false,
};
