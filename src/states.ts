import { AUDIT, COMMAND, GLOBAL } from "./tree_paths";

/** State IDs under this adapter instance (ems.0 = default instance id 0). */
export const STATE = {
	global: GLOBAL,
	command: COMMAND,
	audit: AUDIT,
} as const;

export function instanceState(instanceId: string, relativeId: string): string {
	return `ems.${instanceId}.${relativeId}`;
}
