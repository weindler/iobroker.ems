export const AC_ADDON_ID = "air_conditioning";
export const AC_UNIT_COUNT = 5;
export const AC_TICK_MS = 10_000;
export const AC_WRITE_SETPOINT_DELAY_MS = 5_000;
export const AC_WRITE_REFRESH_DELAY_MS = 5_000;
/** Live: volle Start-Sequenz frühestens wieder nach … ms, wenn Feedback noch off. */
export const AC_START_RETRY_MS = 120_000;
/** Live: volle Stop-Sequenz frühestens wieder nach … ms, wenn Feedback noch on. */
export const AC_STOP_RETRY_MS = 60_000;
/** Nach Startsequenz kurz warten, bis SmartThings feedback_switch aktualisiert. */
export const AC_FEEDBACK_POLL_MS = 3_000;
export const AC_FEEDBACK_POLL_ATTEMPTS = 6;
/** Während Reinigung SmartThings-Status per refresh aktualisieren. */
export const AC_CLEANING_REFRESH_MS = 30_000;
/** Frühestens danach autoClean als „Reinigung läuft“ werten (Flackern nach Start ignorieren). */
export const AC_CLEANING_ACTIVE_CONFIRM_SEC = 60;
/** Fallback: operatingState=ready erst nach … s (ready ist auch Idle vor Start). */
export const AC_CLEANING_FEEDBACK_MIN_RUNTIME_SEC = 300;

export const AC_PROFILE_IDS = ["generic", "samsung_smartthings"] as const;
export type AcProfileId = (typeof AC_PROFILE_IDS)[number];

export const AC_MAPPING_ROLES = [
	"room_temp",
	"room_humidity",
	"feedback_switch",
	"feedback_mode",
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
	"cmd_cleaning_start",
	"cmd_cleaning_mode",
	"cmd_refresh",
] as const;

export type AcMappingRole = (typeof AC_MAPPING_ROLES)[number];

/** Fremde States, deren Änderung einen Tick auslöst (keine Schreib-/Impuls-States). */
export const AC_WATCH_MAPPING_ROLES: AcMappingRole[] = [
	"room_temp",
	"room_humidity",
	"feedback_switch",
	"feedback_mode",
	"feedback_cleaning_state",
	"feedback_cleaning_mode",
	"feedback_cleaning_progress",
];

export function acUnitMappingCommand(unitIndex: number, role: AcMappingRole): string {
	return `unit_${unitIndex}_${role}`;
}

export function acUnitMappingCommands(): string[] {
	const out: string[] = [];
	for (let i = 1; i <= AC_UNIT_COUNT; i++) {
		for (const role of AC_MAPPING_ROLES) {
			out.push(acUnitMappingCommand(i, role));
		}
	}
	return out;
}

export function acUnitConsumerKey(unitIndex: number): string {
	return `${AC_ADDON_ID}.unit_${unitIndex}`;
}
