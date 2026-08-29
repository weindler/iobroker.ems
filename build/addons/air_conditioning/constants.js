"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.acUnitConsumerKey = exports.acUnitMappingCommands = exports.acMappingFlatPrefix = exports.acUnitMappingCommand = exports.AC_WATCH_MAPPING_ROLES = exports.AC_MAPPING_ROLES = exports.AC_PROFILE_IDS = exports.AC_CLEANING_STUCK_ABORT_SEC = exports.AC_HUMIDITY_OFF_HYSTERESIS_PCT_DEFAULT = exports.AC_CLEANING_MIN_COOL_RUNTIME_MS = exports.AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC = exports.AC_CLEANING_ACTIVE_CONFIRM_SEC = exports.AC_CLEANING_REFRESH_MS = exports.AC_FEEDBACK_POLL_ATTEMPTS = exports.AC_FEEDBACK_POLL_MS = exports.AC_OWNERSHIP_SETTLE_MS = exports.AC_MANUAL_OVERRIDE_DURATION_MS_DEFAULT = exports.AC_STOP_RETRY_MS = exports.AC_START_RETRY_MS = exports.AC_WRITE_REFRESH_DELAY_MS = exports.AC_WRITE_SETPOINT_DELAY_MS = exports.AC_TICK_MS = exports.AC_UNIT_COUNT = exports.AC_ADDON_ID = void 0;
exports.AC_ADDON_ID = "air_conditioning";
exports.AC_UNIT_COUNT = 5;
exports.AC_TICK_MS = 10_000;
exports.AC_WRITE_SETPOINT_DELAY_MS = 5_000;
exports.AC_WRITE_REFRESH_DELAY_MS = 5_000;
/** Live: volle Start-Sequenz frühestens wieder nach … ms, wenn Feedback noch off. */
exports.AC_START_RETRY_MS = 120_000;
/** Live: volle Stop-Sequenz frühestens wieder nach … ms, wenn Feedback noch on. */
exports.AC_STOP_RETRY_MS = 60_000;
/** Klima-/Ownership-Block: erkannter Manual-Override pausiert EMS-Steuerung für diese Dauer. */
exports.AC_MANUAL_OVERRIDE_DURATION_MS_DEFAULT = 30 * 60_000;
/** Kein Mismatch-Alarm kurz nach einem eigenen EMS-Start/Stop (Feedback-Verzögerung). */
exports.AC_OWNERSHIP_SETTLE_MS = 2 * 60_000;
/** Nach Startsequenz kurz warten, bis SmartThings feedback_switch aktualisiert. */
exports.AC_FEEDBACK_POLL_MS = 3_000;
exports.AC_FEEDBACK_POLL_ATTEMPTS = 6;
/** Während Reinigung SmartThings-Status per refresh aktualisieren. */
exports.AC_CLEANING_REFRESH_MS = 30_000;
/** Frühestens danach autoClean als „Reinigung läuft“ werten (Flackern nach Start ignorieren). */
exports.AC_CLEANING_ACTIVE_CONFIRM_SEC = 60;
/** Fallback: operatingState=ready erst nach … s (ready ist auch Idle vor Start). */
exports.AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC = 300;
/** Nach Stopp nur reinigen, wenn die Kühl-/Dry-Phase mindestens so lang war (Kurzabbruch / Fehlstart). */
exports.AC_CLEANING_MIN_COOL_RUNTIME_MS = 5 * 60_000;
/** Default Feuchte-Abschalt-Hysterese (%-Punkte unter Max), wenn Admin nichts setzt. */
exports.AC_HUMIDITY_OFF_HYSTERESIS_PCT_DEFAULT = 3;
/**
 * Reinigung abbrechen, wenn nie autoclean/progress gesehen wurde und operatingState weiter ready
 * (z. B. Stop fehlgeschlagen, Gerät lief weiter — sonst Deadlock: cleaning sperrt Stop).
 */
exports.AC_CLEANING_STUCK_ABORT_SEC = 180;
exports.AC_PROFILE_IDS = ["generic", "samsung_smartthings", "samsung_localthings_hass"];
exports.AC_MAPPING_ROLES = [
    "room_temp",
    "room_humidity",
    "feedback_switch",
    "feedback_mode",
    "feedback_setpoint",
    "feedback_cleaning_state",
    "feedback_cleaning_mode",
    "feedback_cleaning_progress",
    "cmd_switch_on",
    "cmd_switch_off",
    "cmd_set_mode",
    "cmd_set_fan_mode",
    "cmd_set_fan_speed",
    "cmd_set_cool_setpoint",
    "cmd_set_heat_setpoint",
    "cmd_set_preset_mode",
    "feedback_preset_mode",
    "cmd_set_swing_mode",
    "feedback_swing_mode",
    "cmd_cleaning_start",
    "cmd_cleaning_off",
    "cmd_cleaning_mode",
    "cmd_refresh",
    "power_w",
    "energy_kwh",
    "filter_usage_pct",
    "filter_usage_hours",
    "filter_status",
    "diagnosis_status",
    "alarm_code",
    "firmware_update",
    "cmd_diagnosis_start",
    "display_light",
    "cmd_display_on",
    "cmd_display_off",
    "sound",
    "cmd_sound_on",
    "cmd_sound_off",
    "cmd_mute_once",
];
/** Fremde States, deren Änderung einen Tick auslöst (keine Schreib-/Impuls-States). */
exports.AC_WATCH_MAPPING_ROLES = [
    "room_temp",
    "room_humidity",
    "feedback_switch",
    "feedback_mode",
    "feedback_setpoint",
    "feedback_cleaning_state",
    "feedback_cleaning_mode",
    "feedback_cleaning_progress",
    "power_w",
    "filter_status",
];
function acUnitMappingCommand(unitIndex, role) {
    return `unit_${unitIndex}_${role}`;
}
exports.acUnitMappingCommand = acUnitMappingCommand;
function acMappingFlatPrefix(unitIndex, role) {
    return `ac_u${unitIndex}_${role}`;
}
exports.acMappingFlatPrefix = acMappingFlatPrefix;
function acUnitMappingCommands() {
    const out = [];
    for (let i = 1; i <= exports.AC_UNIT_COUNT; i++) {
        for (const role of exports.AC_MAPPING_ROLES) {
            out.push(acUnitMappingCommand(i, role));
        }
    }
    return out;
}
exports.acUnitMappingCommands = acUnitMappingCommands;
function acUnitConsumerKey(unitIndex) {
    return `${exports.AC_ADDON_ID}.unit_${unitIndex}`;
}
exports.acUnitConsumerKey = acUnitConsumerKey;
