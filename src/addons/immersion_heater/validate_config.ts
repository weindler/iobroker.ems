import type { ConfigValidationResult, ImmersionDeviceConfig } from "./runtime/types";
import { activeStages } from "./device_config";

export function validateImmersionDeviceConfig(config: ImmersionDeviceConfig): ConfigValidationResult {
	const errors: string[] = [];

	if (config.planningMinTempC >= config.planningMaxTempC) {
		errors.push("planning_min_temp_c_must_be_below_max");
	}
	if (config.temperatureHysteresisK < 0) {
		errors.push("temperature_hysteresis_negative");
	}
	if (config.stageCount < 1 || config.stageCount > 3) {
		errors.push("invalid_stage_count");
	}
	if (config.minimumRuntimeSec < 0) {
		errors.push("minimum_runtime_negative");
	}
	if (config.minimumPauseSec < 0) {
		errors.push("minimum_pause_negative");
	}
	if (config.powerOnThresholdW < 0 || config.powerOffThresholdW < 0) {
		errors.push("power_threshold_negative");
	}
	if (config.powerOffThresholdW >= config.powerOnThresholdW && config.actualPowerStateId) {
		errors.push("power_off_threshold_not_below_on");
	}
	if (config.temperaturePlausibleMinC >= config.temperaturePlausibleMaxC) {
		errors.push("temperature_plausible_range_invalid");
	}

	const enabled = activeStages(config);
	if (enabled.length === 0) {
		errors.push("no_active_stage_with_set_state");
	}
	for (const s of enabled) {
		if (s.nominalPowerW <= 0) {
			errors.push(`stage_${s.index}_nominal_power_missing`);
		}
	}

	const forceStage = config.stages.find((s) => s.index === config.forceDefaultStage);
	if (!forceStage?.enabled || !forceStage.setStateId) {
		errors.push("force_default_stage_invalid");
	}

	if (!config.bufferTempEnabled || !config.bufferTempStateId) {
		errors.push("buffer_temp_mapping_missing");
	}

	return { valid: errors.length === 0, errors };
}
