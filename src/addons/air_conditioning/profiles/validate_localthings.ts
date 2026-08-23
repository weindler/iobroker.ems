import type { AcMappingRole, AcProfileId } from "../constants";
import { isLocalthingsHassProfile } from "./registry";

export type AcMappingValidationIssue = {
	unitIndex: number;
	role?: AcMappingRole;
	severity: "error" | "warning";
	messageDe: string;
};

const LOCALTHINGS_REQUIRED: AcMappingRole[] = [
	"feedback_switch",
	"cmd_switch_on",
	"cmd_switch_off",
	"cmd_set_cool_setpoint",
	"cmd_set_mode",
	"room_temp",
];

function targetOf(
	targets: Partial<Record<AcMappingRole, string>>,
	role: AcMappingRole,
): string {
	return (targets[role] ?? "").trim();
}

/**
 * Profilabhängige Mapping-Validierung (kein Startabbruch — Issues für Admin/Diagnose).
 * LocalThings: kein Refresh-Pflichtfeld; Write-States dürfen write-only sein.
 */
export function validateAcUnitMappings(input: {
	unitIndex: number;
	profileId: AcProfileId | string;
	targets: Partial<Record<AcMappingRole, string>>;
}): AcMappingValidationIssue[] {
	const issues: AcMappingValidationIssue[] = [];
	const { unitIndex, profileId, targets } = input;

	if (!isLocalthingsHassProfile(profileId)) {
		return issues;
	}

	for (const role of LOCALTHINGS_REQUIRED) {
		if (!targetOf(targets, role)) {
			issues.push({
				unitIndex,
				role,
				severity: "error",
				messageDe: `LocalThings: Pflicht-Mapping fehlt (${role}).`,
			});
		}
	}

	const refresh = targetOf(targets, "cmd_refresh");
	if (refresh) {
		issues.push({
			unitIndex,
			role: "cmd_refresh",
			severity: "warning",
			messageDe: "LocalThings: Refresh-Mapping ist unnötig (lokal über HASS) — kein Fehler.",
		});
	}

	return issues;
}

export function localthingsMappingsValid(
	profileId: string,
	targets: Partial<Record<AcMappingRole, string>>,
): boolean {
	return validateAcUnitMappings({ unitIndex: 1, profileId, targets }).every((i) => i.severity !== "error");
}
