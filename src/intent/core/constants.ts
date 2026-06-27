import type { WallboxChargeStrategy } from "./types";

export const INTENT_SCHEMA_VERSION = 1;
export const INTENT_ENGINE_VERSION = "0.1.51";
export const INTENT_CONTRACT_VERSION = "1";

export const DEFAULT_TIMEZONE = "Europe/Berlin";

/** Kleiner deterministischer Debounce für EVCC-State-Bündel (ms). */
export const EVCC_INTENT_DEBOUNCE_MS = 300;

export const WALLBOX_TARGET_ID = "main";

/** Admin-Konfigurationsschlüssel */
export const ADMIN_INTENT_EVCC_MODE_STATE = "intent_evcc_mode_state";
export const ADMIN_INTENT_EVCC_TARGET_SOC_STATE = "intent_evcc_target_soc_state";
export const ADMIN_INTENT_EVCC_DEADLINE_STATE = "intent_evcc_deadline_state";
export const ADMIN_INTENT_EVCC_IMMEDIATE_STATE = "intent_evcc_immediate_state";
export const ADMIN_INTENT_EVCC_SOURCE_TIMESTAMP_STATE = "intent_evcc_source_timestamp_state";
export const ADMIN_INTENT_DEFAULT_CHARGE_STRATEGY = "intent_default_charge_strategy";
export const ADMIN_INTENT_DEFAULT_TARGET_SOC_PCT = "intent_default_target_soc_pct";
export const ADMIN_INTENT_TIMEZONE = "intent_timezone";
export const ADMIN_INTENT_MANUAL_OVERRIDE_MAX_MINUTES = "intent_manual_override_max_minutes";

export const IOBROKER_WALLBOX_REQUEST_STATE = "user_intent.inputs.iobroker.wallbox.request_json";
export const IOBROKER_WALLBOX_RESULT_STATE = "user_intent.inputs.iobroker.wallbox.result_json";

export const EVCC_MODE_MAP: Record<string, WallboxChargeStrategy> = {
	off: "off",
	minpv: "min_pv",
	min_pv: "min_pv",
	pv: "pv",
	now: "immediate",
	immediate: "immediate",
};

export const CHARGE_STRATEGY_LABELS: Record<WallboxChargeStrategy, string> = {
	off: "Off",
	min_pv: "Min+PV",
	pv: "PV",
	immediate: "Sofort",
	unknown: "Unbekannt",
};
