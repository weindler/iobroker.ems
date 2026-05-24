/** Batterie-Status (Controller + Spiegel für Vis). */

export const BATTERY_STATUS_STATES = {
	controller: "status.battery.controller",
	gridBalanceEnabled: "status.battery.grid_balance_enabled",
	updatedAt: "status.battery.updated_at",
} as const;

export async function ensureBatteryStatusStates(adapter: ioBroker.Adapter): Promise<void> {
	const defs: Array<{ _id: string; common: ioBroker.StateCommon; defVal?: ioBroker.StateValue }> = [
		{
			_id: BATTERY_STATUS_STATES.controller,
			common: {
				name: "Batterie-Controller (idle|grid_balance|ems)",
				type: "string",
				role: "text",
				read: true,
				write: false,
				def: "idle",
			},
			defVal: "idle",
		},
		{
			_id: BATTERY_STATUS_STATES.gridBalanceEnabled,
			common: {
				name: "Netzausgleich aktiv (EMS-Spiegel)",
				type: "boolean",
				role: "state",
				read: true,
				write: false,
				def: false,
			},
			defVal: false,
		},
		{
			_id: BATTERY_STATUS_STATES.updatedAt,
			common: {
				name: "Batterie-Status zuletzt aktualisiert",
				type: "string",
				role: "date",
				read: true,
				write: false,
			},
		},
	];

	for (const def of defs) {
		await adapter.setObjectNotExistsAsync(def._id, {
			type: "state",
			common: def.common,
			native: {},
		});
		if (def.defVal !== undefined) {
			const cur = await adapter.getStateAsync(def._id);
			if (cur?.val === undefined || cur.val === null || cur.val === "") {
				await adapter.setStateAsync(def._id, { val: def.defVal, ack: true });
			}
		}
	}
}
