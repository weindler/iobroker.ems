import {
	DEFAULT_FULL_CHARGE_SOC,
	DEFAULT_LOOKBACK_DAYS,
	DEFAULT_NIGHT_END,
	DEFAULT_NIGHT_START,
	DEFAULT_SECONDS_SINCE_FULL_STATE,
	DEFAULT_TOPOFF_INTERVAL_DAYS,
} from "./constants";
import type { BatteryRuntimeConfig } from "./types";

function strField(config: Record<string, unknown>, key: string): string {
	const v = config[key];
	return typeof v === "string" ? v.trim() : "";
}

function boolField(config: Record<string, unknown>, key: string, defaultVal: boolean): boolean {
	const v = config[key];
	if (typeof v === "boolean") return v;
	if (typeof v === "number") return v !== 0;
	if (typeof v === "string") {
		const s = v.trim().toLowerCase();
		if (["1", "true", "on", "yes", "ja"].includes(s)) return true;
		if (["0", "false", "off", "no", "nein"].includes(s)) return false;
	}
	return defaultVal;
}

function numField(
	config: Record<string, unknown>,
	key: string,
	defaultVal: number,
	min: number,
	max: number,
): number {
	const raw = config[key];
	const n = typeof raw === "number" ? raw : parseFloat(String(raw ?? ""));
	if (!Number.isFinite(n)) return defaultVal;
	return Math.min(max, Math.max(min, n));
}

function timeField(config: Record<string, unknown>, key: string, defaultVal: string): string {
	const v = strField(config, key);
	return /^\d{1,2}:\d{2}$/.test(v) ? v : defaultVal;
}

export function batteryRuntimeConfigFromAdapter(config: unknown): BatteryRuntimeConfig {
	const c =
		config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	return {
		enabled: boolField(c, "learning_battery_runtime_enabled", true),
		lookbackDays: Math.round(
			numField(c, "learning_battery_runtime_lookback_days", DEFAULT_LOOKBACK_DAYS, 7, 365),
		),
		socStateId: strField(c, "learning_battery_runtime_soc_state"),
		powerStateId: strField(c, "learning_battery_runtime_power_state"),
		powerInvert: boolField(c, "learning_battery_runtime_power_invert", false),
		capacityStateId: strField(c, "learning_battery_runtime_capacity_state"),
		secondsSinceFullStateId:
			strField(c, "learning_battery_runtime_seconds_since_full_state") ||
			DEFAULT_SECONDS_SINCE_FULL_STATE,
		fullChargeSoc: numField(
			c,
			"learning_battery_runtime_full_charge_soc",
			DEFAULT_FULL_CHARGE_SOC,
			99,
			100,
		),
		topoffIntervalDays: Math.round(
			numField(
				c,
				"learning_battery_runtime_topoff_interval_days",
				DEFAULT_TOPOFF_INTERVAL_DAYS,
				1,
				90,
			),
		),
		nightStart: timeField(c, "learning_battery_runtime_night_start", DEFAULT_NIGHT_START),
		nightEnd: timeField(c, "learning_battery_runtime_night_end", DEFAULT_NIGHT_END),
		nightAstroEnabled: boolField(c, "learning_battery_runtime_night_astro_enabled", false),
		nightStartStateId: strField(c, "learning_battery_runtime_night_start_state"),
		nightEndStateId: strField(c, "learning_battery_runtime_night_end_state"),
	};
}

export function nightAstroConfigReady(cfg: BatteryRuntimeConfig): boolean {
	return cfg.nightAstroEnabled && Boolean(cfg.nightStartStateId && cfg.nightEndStateId);
}

export function sourceLabelFromStateId(stateId: string): string {
	if (!stateId) return "none";
	const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
	return m ? m[1] : stateId.split(".")[0] || "unknown";
}
