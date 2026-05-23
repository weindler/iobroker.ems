/** State IDs under this adapter instance (ems.0 = default instance id 0). */
export const STATE = {
	config: {
		executionEnabled: "config.execution_enabled",
	},
	command: {
		inbox: "command.inbox",
		lastResult: "command.last_result",
	},
	audit: {
		lastEvent: "audit.last_event",
	},
} as const;

export function instanceState(instanceId: string, relativeId: string): string {
	return `ems.${instanceId}.${relativeId}`;
}
