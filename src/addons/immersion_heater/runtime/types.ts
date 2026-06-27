/** Immersion heater runtime — Phase 3C.1 */

export type ThermalControlMode = "off" | "auto" | "force";

export type ImmersionRuntimeState =
	| "disabled"
	| "off"
	| "auto_ready"
	| "force_waiting_for_pause"
	| "force_heating"
	| "force_target_reached"
	| "fault_lockout"
	| "invalid_config"
	| "sensor_unavailable";

export type ImmersionFaultCode =
	| "none"
	| "invalid_configuration"
	| "temperature_missing"
	| "temperature_stale"
	| "temperature_implausible"
	| "no_power_when_on"
	| "power_when_off"
	| "power_mismatch"
	| "relay_chatter"
	| "feedback_mismatch"
	| "write_failed";

export type TemperatureStatus = "valid" | "missing" | "stale" | "implausible";

export type PowerVerificationStatus = "verified" | "unverified" | "unavailable" | "fault";

export interface ImmersionStageConfig {
	index: number;
	enabled: boolean;
	name: string;
	nominalPowerW: number;
	setStateId: string;
	feedbackStateId: string;
}

export interface ImmersionDeviceConfig {
	phaseCount: 1 | 3;
	stageCount: 1 | 2 | 3;
	stages: ImmersionStageConfig[];
	planningMinTempC: number;
	planningMaxTempC: number;
	temperatureHysteresisK: number;
	temperatureMaxAgeSec: number;
	temperaturePlausibleMinC: number;
	temperaturePlausibleMaxC: number;
	minimumRuntimeSec: number;
	minimumPauseSec: number;
	forceDefaultStage: number;
	actualPowerStateId: string;
	powerOnThresholdW: number;
	powerOffThresholdW: number;
	powerTolerancePct: number;
	switchOnCheckDelaySec: number;
	switchOffCheckDelaySec: number;
	powerMismatchDurationSec: number;
	relayChatterWindowSec: number;
	relayChatterMaxChanges: number;
	bufferTempStateId: string;
	bufferTempEnabled: boolean;
}

export interface ConfigValidationResult {
	valid: boolean;
	errors: string[];
}

export interface TemperatureReading {
	valueC: number | null;
	status: TemperatureStatus;
	observedAtMs: number | null;
}

export interface RuntimePersistData {
	resolvedMode: ThermalControlMode;
	forceTargetTempC: number | null;
	forceUntil: string | null;
	lastSwitchAtMs: number | null;
	lastOffAtMs: number | null;
	faultLockout: boolean;
	faultCode: ImmersionFaultCode;
	faultSince: string | null;
	commandedStage: number;
	minRuntimeUntilMs: number | null;
	pauseUntilMs: number | null;
}

export interface RuntimeSnapshot {
	schema_version: 1;
	available: boolean;
	state: ImmersionRuntimeState;
	requested_mode: ThermalControlMode;
	resolved_mode: ThermalControlMode;
	buffer_temperature_c: number | null;
	temperature_status: TemperatureStatus;
	planning_min_temp_c: number;
	planning_max_temp_c: number;
	force_target_temp_c: number | null;
	force_until: string | null;
	commanded_stage: number;
	commanded_power_w: number;
	feedback_stage: number;
	measured_power_w: number | null;
	power_verification_status: PowerVerificationStatus;
	minimum_runtime_remaining_sec: number;
	minimum_pause_remaining_sec: number;
	last_switch_at: string | null;
	fault_active: boolean;
	fault_code: ImmersionFaultCode;
	fault_since: string | null;
	fault_message: string;
	reason: string;
	execution_mode: "dryrun" | "live";
	updated_at: string;
}

export const IMMERSION_RUNTIME_BASE = "addons.immersion_heater.runtime";

export const IMMERSION_RUNTIME_STATES = {
	available: `${IMMERSION_RUNTIME_BASE}.available`,
	state: `${IMMERSION_RUNTIME_BASE}.state`,
	requestedMode: `${IMMERSION_RUNTIME_BASE}.requested_mode`,
	resolvedMode: `${IMMERSION_RUNTIME_BASE}.resolved_mode`,
	bufferTemperatureC: `${IMMERSION_RUNTIME_BASE}.buffer_temperature_c`,
	temperatureStatus: `${IMMERSION_RUNTIME_BASE}.temperature_status`,
	planningMinTempC: `${IMMERSION_RUNTIME_BASE}.planning_min_temp_c`,
	planningMaxTempC: `${IMMERSION_RUNTIME_BASE}.planning_max_temp_c`,
	forceTargetTempC: `${IMMERSION_RUNTIME_BASE}.force_target_temp_c`,
	forceUntil: `${IMMERSION_RUNTIME_BASE}.force_until`,
	commandedStage: `${IMMERSION_RUNTIME_BASE}.commanded_stage`,
	commandedPowerW: `${IMMERSION_RUNTIME_BASE}.commanded_power_w`,
	feedbackStage: `${IMMERSION_RUNTIME_BASE}.feedback_stage`,
	measuredPowerW: `${IMMERSION_RUNTIME_BASE}.measured_power_w`,
	powerVerificationStatus: `${IMMERSION_RUNTIME_BASE}.power_verification_status`,
	minRuntimeRemainingSec: `${IMMERSION_RUNTIME_BASE}.minimum_runtime_remaining_sec`,
	minPauseRemainingSec: `${IMMERSION_RUNTIME_BASE}.minimum_pause_remaining_sec`,
	lastSwitchAt: `${IMMERSION_RUNTIME_BASE}.last_switch_at`,
	faultActive: `${IMMERSION_RUNTIME_BASE}.fault_active`,
	faultCode: `${IMMERSION_RUNTIME_BASE}.fault_code`,
	faultSince: `${IMMERSION_RUNTIME_BASE}.fault_since`,
	faultMessage: `${IMMERSION_RUNTIME_BASE}.fault_message`,
	faultReset: `${IMMERSION_RUNTIME_BASE}.fault_reset`,
	reason: `${IMMERSION_RUNTIME_BASE}.reason`,
	snapshotJson: `${IMMERSION_RUNTIME_BASE}.snapshot_json`,
} as const;
