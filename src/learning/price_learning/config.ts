import { DEFAULT_LOOKBACK_DAYS, DEFAULT_PRICE_STATE_ID } from "./constants";
import type { PriceLearningConfig } from "./types";

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

export function priceLearningConfigFromAdapter(config: unknown): PriceLearningConfig {
	const c =
		config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const lookbackRaw = c.learning_price_lookback_days;
	const lookbackN =
		typeof lookbackRaw === "number" ? lookbackRaw : parseInt(String(lookbackRaw ?? ""), 10);
	const lookbackDays =
		Number.isFinite(lookbackN) && lookbackN >= 7 && lookbackN <= 365
			? Math.round(lookbackN)
			: DEFAULT_LOOKBACK_DAYS;

	const configuredState = strField(c, "learning_price_source_state");

	return {
		enabled: boolField(c, "learning_price_enabled", true),
		priceStateId: configuredState || DEFAULT_PRICE_STATE_ID,
		lookbackDays,
	};
}

export function priceLearningConfigReady(cfg: PriceLearningConfig): boolean {
	return Boolean(cfg.priceStateId);
}

export function sourceLabelFromStateId(stateId: string): string {
	if (stateId === DEFAULT_PRICE_STATE_ID) {
		return "ems_live_price";
	}
	const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
	return m ? m[1] : stateId.split(".")[0] || "unknown";
}
