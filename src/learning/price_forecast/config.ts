import { normalizeFreezeTime, parseFreezeTimeHHMM } from "../pv_bias/config";
import {
	DEFAULT_LOOKBACK_DAYS,
	DEFAULT_TODAY_FREEZE_TIME,
	DEFAULT_TOMORROW_FREEZE_TIME,
} from "./constants";
import type { PriceForecastConfig } from "./types";

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

export function priceForecastConfigFromAdapter(config: unknown): PriceForecastConfig {
	const c =
		config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const lookbackRaw = c.learning_price_forecast_lookback_days;
	const lookbackN =
		typeof lookbackRaw === "number" ? lookbackRaw : parseInt(String(lookbackRaw ?? ""), 10);
	const lookbackDays =
		Number.isFinite(lookbackN) && lookbackN >= 7 && lookbackN <= 365
			? Math.round(lookbackN)
			: DEFAULT_LOOKBACK_DAYS;

	const tomorrowFreezeRaw =
		strField(c, "learning_price_forecast_freeze_time") ||
		strField(c, "learning_price_forecast_tomorrow_freeze_time") ||
		DEFAULT_TOMORROW_FREEZE_TIME;
	const todayFreezeRaw =
		strField(c, "learning_price_forecast_today_freeze_time") || DEFAULT_TODAY_FREEZE_TIME;

	return {
		enabled: boolField(c, "learning_price_forecast_enabled", true),
		freezeEnabled: boolField(c, "learning_price_forecast_freeze_enabled", true),
		tomorrowFreezeTime: normalizeFreezeTime(tomorrowFreezeRaw),
		todayFreezeEnabled: boolField(c, "learning_price_forecast_today_freeze_enabled", true),
		todayFreezeTime: normalizeFreezeTime(todayFreezeRaw),
		todayJsonStateId: strField(c, "learning_price_forecast_today_json_state"),
		tomorrowJsonStateId: strField(c, "learning_price_forecast_tomorrow_json_state"),
		actualStateId: strField(c, "learning_price_forecast_actual_state"),
		lookbackDays,
	};
}

export function priceForecastConfigReady(cfg: PriceForecastConfig): boolean {
	return Boolean(
		cfg.actualStateId && (cfg.tomorrowJsonStateId || cfg.todayJsonStateId),
	);
}

export function sourceLabelFromStateId(stateId: string): string {
	const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
	return m ? m[1] : stateId.split(".")[0] || "unknown";
}

export { parseFreezeTimeHHMM };
