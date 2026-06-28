import { hardwareLimitsFromConfig } from "./core/limits";
import type { BatteryHardwareLimits, BatteryProfileId, CapacitySource, PowerSignConvention } from "./core/types";

function rec(config: unknown): Record<string, unknown> {
	return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

function str(c: Record<string, unknown>, key: string): string {
	const v = c[key];
	return typeof v === "string" ? v.trim() : "";
}

function num(c: Record<string, unknown>, key: string): number | null {
	const v = c[key];
	if (v === null || v === undefined || v === "" || typeof v === "boolean") return null;
	const n = typeof v === "number" ? v : parseFloat(String(v).replace(",", "."));
	return Number.isFinite(n) ? n : null;
}

function intIn(c: Record<string, unknown>, key: string, def: number, min: number, max: number): number {
	const n = num(c, key);
	if (n === null) return def;
	return Math.min(max, Math.max(min, Math.round(n)));
}

function bool(c: Record<string, unknown>, key: string, def = false): boolean {
	const v = c[key];
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
		if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	}
	return def;
}

export function batteryProfileIdFromConfig(config: unknown): BatteryProfileId {
	const raw = str(rec(config), "battery_profile").toLowerCase();
	if (raw === "generic_readonly") return "generic_readonly";
	if (raw === "sonnen_em" || raw === "sonnen") return "sonnen_em";
	// Default to read-only safety when unknown.
	return raw === "" ? "sonnen_em" : "generic_readonly";
}

export interface SonnenSequenceConfig {
	pauseBeforeManualMs: number;
	waitAfterManualMs: number;
	feedbackTimeoutModeMs: number;
	feedbackTimeoutChargeMs: number;
	maxManualModeMs: number;
	restoreDelayMs: number;
}

export interface SonnenModeValues {
	manual: number;
	selfConsumption: number;
}

export interface SonnenFeedbackTolerance {
	absoluteW: number;
	relativePct: number;
}

export interface GridBalanceConfig {
	enabled: boolean;
	offsetHighSocW: number;
	offsetLowSocW: number;
	socThresholdPct: number;
	minChangeW: number;
	maxTargetW: number;
	updateIntervalSec: number;
}

export interface BatteryConfig {
	profile: BatteryProfileId;
	manufacturer: string;
	model: string;
	capacitySource: CapacitySource;
	capacityManualKwh: number | null;
	signConvention: PowerSignConvention;
	limits: BatteryHardwareLimits;
	telemetryMaxAgeMs: number;
	sonnenModeValues: SonnenModeValues;
	sequence: SonnenSequenceConfig;
	feedbackTolerance: SonnenFeedbackTolerance;
	gridBalance: GridBalanceConfig;
}

export function batteryConfigFromAdapter(config: unknown): BatteryConfig {
	const c = rec(config);

	const capSourceRaw = str(c, "battery_capacity_source").toLowerCase();
	const capacitySource: CapacitySource =
		capSourceRaw === "mapped" ? "mapped" : capSourceRaw === "manual" ? "manual" : "manual";

	const signRaw = str(c, "battery_power_sign_convention").toLowerCase();
	const signConvention: PowerSignConvention =
		signRaw === "positive_discharge" ? "positive_discharge" : "positive_charge";

	return {
		profile: batteryProfileIdFromConfig(config),
		manufacturer: str(c, "battery_manufacturer"),
		model: str(c, "battery_model"),
		capacitySource,
		capacityManualKwh: num(c, "battery_capacity_net_kwh"),
		signConvention,
		limits: hardwareLimitsFromConfig(config),
		telemetryMaxAgeMs: intIn(c, "battery_telemetry_max_age_sec", 120, 15, 1800) * 1000,
		sonnenModeValues: {
			manual: intIn(c, "bat_sonnen_manual_mode_value", 1, 0, 99),
			selfConsumption: intIn(c, "bat_sonnen_self_consumption_mode_value", 2, 0, 99),
		},
		sequence: {
			pauseBeforeManualMs: intIn(c, "bat_mode_pause_grid_balance_sec", 10, 0, 120) * 1000,
			waitAfterManualMs: intIn(c, "bat_mode_wait_after_mode_sec", 5, 0, 120) * 1000,
			feedbackTimeoutModeMs: intIn(c, "bat_feedback_timeout_mode_sec", 30, 5, 300) * 1000,
			feedbackTimeoutChargeMs: intIn(c, "bat_feedback_timeout_charge_sec", 30, 5, 300) * 1000,
			maxManualModeMs: intIn(c, "bat_max_manual_mode_sec", 1800, 60, 86_400) * 1000,
			restoreDelayMs: intIn(c, "bat_restore_delay_sec", 2, 0, 120) * 1000,
		},
		feedbackTolerance: {
			absoluteW: intIn(c, "bat_charge_tolerance_w", 500, 0, 10_000),
			relativePct: intIn(c, "bat_charge_tolerance_pct", 15, 0, 100),
		},
		gridBalance: {
			enabled: bool(c, "bat_feature_grid_balance_enabled", false),
			offsetHighSocW: intIn(c, "bat_offset_high_soc_w", 25, 0, 500),
			offsetLowSocW: intIn(c, "bat_offset_low_soc_w", 10, 0, 500),
			socThresholdPct: intIn(c, "bat_offset_soc_threshold_pct", 20, 1, 100),
			minChangeW: intIn(c, "bat_grid_balance_min_change_w", 50, 0, 5000),
			maxTargetW: intIn(c, "bat_grid_balance_max_w", 5000, 0, 50_000),
			updateIntervalSec: intIn(c, "bat_grid_balance_update_interval_sec", 45, 15, 600),
		},
	};
}
