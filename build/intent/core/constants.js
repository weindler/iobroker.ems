"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CHARGE_STRATEGY_LABELS = exports.EVCC_MODE_MAP = exports.IOBROKER_WALLBOX_RESULT_STATE = exports.IOBROKER_WALLBOX_REQUEST_STATE = exports.ADMIN_INTENT_MANUAL_OVERRIDE_MAX_MINUTES = exports.ADMIN_INTENT_TIMEZONE = exports.ADMIN_INTENT_DEFAULT_TARGET_SOC_PCT = exports.ADMIN_INTENT_DEFAULT_CHARGE_STRATEGY = exports.ADMIN_INTENT_EVCC_SOURCE_TIMESTAMP_STATE = exports.ADMIN_INTENT_EVCC_IMMEDIATE_STATE = exports.ADMIN_INTENT_EVCC_DEADLINE_STATE = exports.ADMIN_INTENT_EVCC_TARGET_SOC_STATE = exports.ADMIN_INTENT_EVCC_MODE_STATE = exports.WALLBOX_TARGET_ID = exports.EVCC_INTENT_DEBOUNCE_MS = exports.DEFAULT_TIMEZONE = exports.INTENT_CONTRACT_VERSION = exports.INTENT_ENGINE_VERSION = exports.INTENT_SCHEMA_VERSION = void 0;
exports.INTENT_SCHEMA_VERSION = 1;
exports.INTENT_ENGINE_VERSION = "0.1.53";
exports.INTENT_CONTRACT_VERSION = "1";
exports.DEFAULT_TIMEZONE = "Europe/Berlin";
/** Kleiner deterministischer Debounce für EVCC-State-Bündel (ms). */
exports.EVCC_INTENT_DEBOUNCE_MS = 300;
exports.WALLBOX_TARGET_ID = "main";
/** Admin-Konfigurationsschlüssel */
exports.ADMIN_INTENT_EVCC_MODE_STATE = "intent_evcc_mode_state";
exports.ADMIN_INTENT_EVCC_TARGET_SOC_STATE = "intent_evcc_target_soc_state";
exports.ADMIN_INTENT_EVCC_DEADLINE_STATE = "intent_evcc_deadline_state";
exports.ADMIN_INTENT_EVCC_IMMEDIATE_STATE = "intent_evcc_immediate_state";
exports.ADMIN_INTENT_EVCC_SOURCE_TIMESTAMP_STATE = "intent_evcc_source_timestamp_state";
exports.ADMIN_INTENT_DEFAULT_CHARGE_STRATEGY = "intent_default_charge_strategy";
exports.ADMIN_INTENT_DEFAULT_TARGET_SOC_PCT = "intent_default_target_soc_pct";
exports.ADMIN_INTENT_TIMEZONE = "intent_timezone";
exports.ADMIN_INTENT_MANUAL_OVERRIDE_MAX_MINUTES = "intent_manual_override_max_minutes";
exports.IOBROKER_WALLBOX_REQUEST_STATE = "user_intent.inputs.iobroker.wallbox.request_json";
exports.IOBROKER_WALLBOX_RESULT_STATE = "user_intent.inputs.iobroker.wallbox.result_json";
exports.EVCC_MODE_MAP = {
    off: "off",
    minpv: "min_pv",
    min_pv: "min_pv",
    pv: "pv",
    now: "immediate",
    immediate: "immediate",
};
exports.CHARGE_STRATEGY_LABELS = {
    off: "Off",
    min_pv: "Min+PV",
    pv: "PV",
    immediate: "Sofort",
    unknown: "Unbekannt",
};
