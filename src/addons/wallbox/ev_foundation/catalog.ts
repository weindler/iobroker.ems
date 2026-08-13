/**
 * Canonical EVCC loadpoint-1 paths (documentation / tests).
 * Never auto-filled into existing adapter config.
 */

export const EVCC_LOADPOINT_STATUS_PREFIX = "evcc.0.loadpoint.1.status";
export const EVCC_LOADPOINT_CONTROL_PREFIX = "evcc.0.loadpoint.1.control";

export const EVCC_READ_CATALOG = {
	connection: "evcc.0.info.connection",
	connected: `${EVCC_LOADPOINT_STATUS_PREFIX}.connected`,
	charging: `${EVCC_LOADPOINT_STATUS_PREFIX}.charging`,
	chargePower: `${EVCC_LOADPOINT_STATUS_PREFIX}.chargePower`,
	mode: `${EVCC_LOADPOINT_STATUS_PREFIX}.mode`,
	phasesActive: `${EVCC_LOADPOINT_STATUS_PREFIX}.phasesActive`,
	phasesConfigured: `${EVCC_LOADPOINT_STATUS_PREFIX}.phasesConfigured`,
	maxCurrent: `${EVCC_LOADPOINT_STATUS_PREFIX}.maxCurrent`,
	minCurrent: `${EVCC_LOADPOINT_STATUS_PREFIX}.minCurrent`,
	vehicleSoc: `${EVCC_LOADPOINT_STATUS_PREFIX}.vehicleSoc`,
	vehicleName: `${EVCC_LOADPOINT_STATUS_PREFIX}.vehicleName`,
	vehicleTitle: `${EVCC_LOADPOINT_STATUS_PREFIX}.vehicleTitle`,
	vehicleRange: `${EVCC_LOADPOINT_STATUS_PREFIX}.vehicleRange`,
	vehicleOdometer: `${EVCC_LOADPOINT_STATUS_PREFIX}.vehicleOdometer`,
	chargeRemainingEnergy: `${EVCC_LOADPOINT_STATUS_PREFIX}.chargeRemainingEnergy`,
	chargeRemainingDuration: `${EVCC_LOADPOINT_STATUS_PREFIX}.chargeRemainingDuration`,
	effectiveLimitSoc: `${EVCC_LOADPOINT_STATUS_PREFIX}.effectiveLimitSoc`,
	effectiveMaxCurrent: `${EVCC_LOADPOINT_STATUS_PREFIX}.effectiveMaxCurrent`,
	effectiveMinCurrent: `${EVCC_LOADPOINT_STATUS_PREFIX}.effectiveMinCurrent`,
	offeredCurrent: `${EVCC_LOADPOINT_STATUS_PREFIX}.offeredCurrent`,
	enabled: `${EVCC_LOADPOINT_STATUS_PREFIX}.enabled`,
	chargeCurrents: `${EVCC_LOADPOINT_STATUS_PREFIX}.chargeCurrents`,
	chargeVoltages: `${EVCC_LOADPOINT_STATUS_PREFIX}.chargeVoltages`,
	sessionEnergy: `${EVCC_LOADPOINT_STATUS_PREFIX}.sessionEnergy`,
	sessionPrice: `${EVCC_LOADPOINT_STATUS_PREFIX}.sessionPrice`,
	sessionPricePerKWh: `${EVCC_LOADPOINT_STATUS_PREFIX}.sessionPricePerKWh`,
	vehicleDetectionActive: `${EVCC_LOADPOINT_STATUS_PREFIX}.vehicleDetectionActive`,
} as const;

export const EVCC_REQUIRED_READ_KEYS = [
	"connection",
	"connected",
	"charging",
	"chargePower",
	"mode",
	"phasesActive",
	"phasesConfigured",
	"maxCurrent",
	"minCurrent",
] as const;

export type EvccRequiredReadKey = (typeof EVCC_REQUIRED_READ_KEYS)[number];
