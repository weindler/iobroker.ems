import type { ExecutionModeHost } from "./execution_mode";

/** Optionaler EMS-Spiegel: ISO-Timestamp (EMS kann 1×/60 s schreiben). */
export const EMS_MIRROR_ALIVE_AT = "ems_mirror.alive_at";

export async function ensureEmsMirrorAliveState(host: ExecutionModeHost): Promise<void> {
	await host.setObjectNotExistsAsync(EMS_MIRROR_ALIVE_AT, {
		type: "state",
		common: {
			name: "EMS zuletzt aktiv (ISO, optional vom EMS)",
			type: "string",
			role: "date",
			read: true,
			write: true,
		},
		native: {},
	} as ioBroker.Object);
}
