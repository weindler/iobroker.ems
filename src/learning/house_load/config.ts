import { DEFAULT_LOOKBACK_DAYS } from "./constants";
import type { HouseLoadConfig } from "./types";

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

export function houseLoadConfigFromAdapter(config: unknown): HouseLoadConfig {
	const c =
		config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const lookbackRaw = c.learning_house_load_lookback_days;
	const lookbackN =
		typeof lookbackRaw === "number" ? lookbackRaw : parseInt(String(lookbackRaw ?? ""), 10);
	const lookbackDays =
		Number.isFinite(lookbackN) && lookbackN >= 14 && lookbackN <= 365
			? Math.round(lookbackN)
			: DEFAULT_LOOKBACK_DAYS;

	return {
		enabled: boolField(c, "learning_house_load_enabled", true),
		lookbackDays,
		powerStateId: strField(c, "learning_house_load_power_state"),
	};
}

export function sourceLabelFromStateId(stateId: string): string {
	const m = stateId.match(/^([a-z0-9_-]+)\.\d+\./i);
	return m ? m[1] : stateId.split(".")[0] || "unknown";
}
