import type {
	ImmersionDeviceConfig,
	ImmersionFaultCode,
	ImmersionRuntimeState,
	PowerVerificationStatus,
	TemperatureReading,
	ThermalControlMode,
} from "./types";
import { effectiveForceTarget } from "../device_config";
import type { RuntimePersistData } from "./types";

export interface FsmInput {
	nowMs: number;
	addonEnabled: boolean;
	addonAvailable: boolean;
	configValid: boolean;
	executionLive: boolean;
	failsafeActive: boolean;
	resolvedMode: ThermalControlMode;
	forceTargetTempC: number | null;
	forceUntilMs: number | null;
	temperature: TemperatureReading;
	measuredPowerW: number | null;
	hasPowerMeasurement: boolean;
	persist: RuntimePersistData;
	config: ImmersionDeviceConfig;
	faultLockout: boolean;
	faultCode: ImmersionFaultCode;
}

export interface FsmOutput {
	state: ImmersionRuntimeState;
	available: boolean;
	commandedStage: number;
	commandedPowerW: number;
	reason: string;
	faultCode: ImmersionFaultCode;
	faultLockout: boolean;
	faultMessage: string;
	powerVerificationStatus: PowerVerificationStatus;
	minRuntimeUntilMs: number | null;
	pauseUntilMs: number | null;
	autoRevertToAuto: boolean;
	clearForceFields: boolean;
}

export function runImmersionFsm(input: FsmInput): FsmOutput {
	const {
		nowMs,
		addonEnabled,
		addonAvailable,
		configValid,
		failsafeActive,
		resolvedMode,
		forceTargetTempC,
		forceUntilMs,
		temperature,
		measuredPowerW,
		hasPowerMeasurement,
		persist,
		config,
		faultLockout,
		faultCode,
	} = input;

	const base: FsmOutput = {
		state: "off",
		available: false,
		commandedStage: 0,
		commandedPowerW: 0,
		reason: "",
		faultCode,
		faultLockout,
		faultMessage: "",
		powerVerificationStatus: hasPowerMeasurement ? "unverified" : "unavailable",
		minRuntimeUntilMs: persist.minRuntimeUntilMs,
		pauseUntilMs: persist.pauseUntilMs,
		autoRevertToAuto: false,
		clearForceFields: false,
	};

	if (!addonEnabled || !addonAvailable) {
		return { ...base, state: "disabled", reason: "addon_disabled" };
	}
	if (!configValid) {
		return { ...base, state: "invalid_config", reason: "invalid_configuration" };
	}
	if (faultLockout && faultCode !== "none") {
		return {
			...base,
			state: "fault_lockout",
			available: false,
			faultLockout: true,
			faultMessage: faultCode,
			reason: "fault_lockout",
		};
	}
	if (failsafeActive) {
		return { ...base, state: "off", reason: "failsafe_active", commandedStage: 0 };
	}

	if (temperature.status !== "valid") {
		const st: ImmersionRuntimeState = temperature.status === "missing" ? "sensor_unavailable" : "sensor_unavailable";
		return {
			...base,
			state: st,
			available: resolvedMode === "auto",
			reason: `temperature_${temperature.status}`,
			commandedStage: 0,
		};
	}

	if (resolvedMode === "off") {
		const minRuntimeActive = persist.minRuntimeUntilMs !== null && nowMs < persist.minRuntimeUntilMs;
		if (minRuntimeActive) {
			return {
				...base,
				state: "off",
				reason: "off_overrides_min_runtime",
				commandedStage: 0,
				minRuntimeUntilMs: null,
			};
		}
		return { ...base, state: "off", reason: "user_off", commandedStage: 0, available: false };
	}

	if (resolvedMode === "auto") {
		return {
			...base,
			state: "auto_ready",
			available: true,
			reason: "auto_ready_for_planner",
			commandedStage: 0,
		};
	}

	// force
	const target = effectiveForceTarget(config, forceTargetTempC);
	const temp = temperature.valueC!;
	const reheatThreshold = target - config.temperatureHysteresisK;

	if (temp >= target) {
		return {
			...base,
			state: "force_target_reached",
			available: true,
			reason: "force_target_already_reached",
			commandedStage: 0,
			autoRevertToAuto: true,
			clearForceFields: true,
		};
	}

	if (forceUntilMs !== null && nowMs >= forceUntilMs) {
		return {
			...base,
			state: "force_target_reached",
			available: true,
			reason: "force_until_expired",
			commandedStage: 0,
			autoRevertToAuto: true,
			clearForceFields: true,
		};
	}

	if (persist.pauseUntilMs !== null && nowMs < persist.pauseUntilMs) {
		return {
			...base,
			state: "force_waiting_for_pause",
			available: true,
			reason: "minimum_pause",
			commandedStage: 0,
			pauseUntilMs: persist.pauseUntilMs,
		};
	}

	const stage = config.stages.find((s) => s.index === config.forceDefaultStage);
	if (!stage?.enabled || !stage.setStateId || stage.nominalPowerW <= 0) {
		return {
			...base,
			state: "invalid_config",
			reason: "force_default_stage_unavailable",
			commandedStage: 0,
		};
	}

	if (persist.commandedStage > 0 && temp >= reheatThreshold && temp < target) {
		return {
			...base,
			state: "force_target_reached",
			available: true,
			reason: "force_hysteresis_off",
			commandedStage: 0,
		};
	}

	const minRuntimeActive = persist.minRuntimeUntilMs !== null && nowMs < persist.minRuntimeUntilMs;
	if (minRuntimeActive && persist.commandedStage > 0) {
		return {
			...base,
			state: "force_heating",
			available: true,
			reason: "minimum_runtime",
			commandedStage: persist.commandedStage,
			commandedPowerW: stage.nominalPowerW,
			minRuntimeUntilMs: persist.minRuntimeUntilMs,
			powerVerificationStatus: evaluatePower(hasPowerMeasurement, measuredPowerW, stage.nominalPowerW, true, config),
		};
	}

	return {
		...base,
		state: "force_heating",
		available: true,
		reason: "force_heating",
		commandedStage: stage.index,
		commandedPowerW: stage.nominalPowerW,
		minRuntimeUntilMs: nowMs + config.minimumRuntimeSec * 1000,
		powerVerificationStatus: evaluatePower(hasPowerMeasurement, measuredPowerW, stage.nominalPowerW, true, config),
	};
}

function evaluatePower(
	hasMeasurement: boolean,
	measured: number | null,
	nominal: number,
	on: boolean,
	config: ImmersionDeviceConfig,
): PowerVerificationStatus {
	if (!hasMeasurement || measured === null) return "unavailable";
	if (on && measured >= config.powerOnThresholdW) return "verified";
	if (!on && measured <= config.powerOffThresholdW) return "verified";
	return "unverified";
}

export function evaluateTemperature(
	value: number | null,
	observedAtMs: number | null,
	nowMs: number,
	config: ImmersionDeviceConfig,
): TemperatureReading {
	if (value === null || !Number.isFinite(value)) {
		return { valueC: null, status: "missing", observedAtMs };
	}
	if (value < config.temperaturePlausibleMinC || value > config.temperaturePlausibleMaxC) {
		return { valueC: value, status: "implausible", observedAtMs };
	}
	if (observedAtMs === null || nowMs - observedAtMs > config.temperatureMaxAgeSec * 1000) {
		return { valueC: value, status: "stale", observedAtMs };
	}
	return { valueC: value, status: "valid", observedAtMs };
}

export function operatingRequestToControlMode(op: string | null): ThermalControlMode {
	if (op === "off") return "off";
	if (op === "force_on" || op === "force_off") return "force";
	return "auto";
}

export function controlModeToOperatingRequest(mode: ThermalControlMode): "off" | "auto" | "force_on" {
	if (mode === "off") return "off";
	if (mode === "force") return "force_on";
	return "auto";
}
