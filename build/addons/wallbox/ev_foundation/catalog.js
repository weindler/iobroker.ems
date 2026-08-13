"use strict";
/**
 * Canonical EVCC loadpoint-1 paths (documentation / tests).
 * Never auto-filled into existing adapter config.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.EVCC_REQUIRED_READ_KEYS = exports.EVCC_READ_CATALOG = exports.EVCC_LOADPOINT_CONTROL_PREFIX = exports.EVCC_LOADPOINT_STATUS_PREFIX = void 0;
exports.EVCC_LOADPOINT_STATUS_PREFIX = "evcc.0.loadpoint.1.status";
exports.EVCC_LOADPOINT_CONTROL_PREFIX = "evcc.0.loadpoint.1.control";
exports.EVCC_READ_CATALOG = {
    connection: "evcc.0.info.connection",
    connected: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.connected`,
    charging: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.charging`,
    chargePower: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.chargePower`,
    mode: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.mode`,
    phasesActive: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.phasesActive`,
    phasesConfigured: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.phasesConfigured`,
    maxCurrent: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.maxCurrent`,
    minCurrent: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.minCurrent`,
    vehicleSoc: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.vehicleSoc`,
    vehicleName: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.vehicleName`,
    vehicleTitle: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.vehicleTitle`,
    vehicleRange: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.vehicleRange`,
    vehicleOdometer: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.vehicleOdometer`,
    chargeRemainingEnergy: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.chargeRemainingEnergy`,
    chargeRemainingDuration: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.chargeRemainingDuration`,
    effectiveLimitSoc: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.effectiveLimitSoc`,
    effectiveMaxCurrent: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.effectiveMaxCurrent`,
    effectiveMinCurrent: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.effectiveMinCurrent`,
    offeredCurrent: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.offeredCurrent`,
    enabled: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.enabled`,
    chargeCurrents: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.chargeCurrents`,
    chargeVoltages: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.chargeVoltages`,
    sessionEnergy: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.sessionEnergy`,
    sessionPrice: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.sessionPrice`,
    sessionPricePerKWh: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.sessionPricePerKWh`,
    vehicleDetectionActive: `${exports.EVCC_LOADPOINT_STATUS_PREFIX}.vehicleDetectionActive`,
};
exports.EVCC_REQUIRED_READ_KEYS = [
    "connection",
    "connected",
    "charging",
    "chargePower",
    "mode",
    "phasesActive",
    "phasesConfigured",
    "maxCurrent",
    "minCurrent",
];
