import type { PvHorizonConfig } from "./types";
import { PV_HORIZON_DAY_COUNT } from "./constants";
import { pvBiasConfigFromAdapter } from "../pv_bias/config";

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

const DAY_RAW_CONFIG_KEYS = [
	"learning_pv_horizon_day1_raw_state",
	"learning_pv_horizon_day2_raw_state",
	"learning_pv_horizon_day3_raw_state",
	"learning_pv_horizon_day4_raw_state",
	"learning_pv_horizon_day5_raw_state",
	"learning_pv_horizon_day6_raw_state",
	"learning_pv_horizon_day7_raw_state",
] as const;

const DEFAULT_RAW_BY_DAY = [
	"", // day1 filled from pv_bias raw today below
	"", // day2 from pv_bias raw tomorrow
	"",
	"",
	"",
	"",
	"",
];

export function pvHorizonConfigFromAdapter(config: unknown): PvHorizonConfig {
	const c =
		config && typeof config === "object" ? (config as Record<string, unknown>) : {};
	const biasCfg = pvBiasConfigFromAdapter(config);

	const rawStateIds: string[] = [];
	for (let i = 0; i < PV_HORIZON_DAY_COUNT; i++) {
		let id = strField(c, DAY_RAW_CONFIG_KEYS[i]);
		if (!id && i === 0) {
			id = biasCfg.rawTodayStateId;
		}
		if (!id && i === 1) {
			id = biasCfg.rawTomorrowStateId;
		}
		rawStateIds.push(id || DEFAULT_RAW_BY_DAY[i]);
	}

	return {
		enabled: boolField(c, "learning_pv_horizon_enabled", true),
		rawStateIds,
	};
}
