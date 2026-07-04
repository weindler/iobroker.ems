export const AC_ADDON_ID = "air_conditioning";
export const AC_UNIT_COUNT = 5;
export const AC_TICK_MS = 10_000;
export const AC_WRITE_SETPOINT_DELAY_MS = 5_000;
export const AC_WRITE_REFRESH_DELAY_MS = 5_000;
/** Live: volle Start-Sequenz frühestens wieder nach … ms, wenn Feedback noch off. */
export const AC_START_RETRY_MS = 120_000;

export const AC_PROFILE_IDS = ["generic", "samsung_smartthings"] as const;
export type AcProfileId = (typeof AC_PROFILE_IDS)[number];

export const AC_MAPPING_ROLES = [
	"room_temp",
	"room_humidity",
	"feedback_switch",
	"feedback_mode",
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
