import { addonStatusBase } from "./tree_paths";

/** Read-only EMS status mirror for ioBroker Vis (filled by EMS via Simple API). */

const STATUS = addonStatusBase("wallbox");

export const WALLBOX_STATUS_STATES = {
	chargingMode: `${STATUS}.charging_mode`,
	chargingModeLabel: `${STATUS}.charging_mode_label`,
	vehicleSocPct: `${STATUS}.vehicle_soc_pct`,
	updatedAt: `${STATUS}.updated_at`,
} as const;

export async function ensureWallboxStatusStates(
	adapter: ioBroker.Adapter,
): Promise<void> {
	const defs: Array<{ _id: string; common: ioBroker.StateCommon; defVal?: ioBroker.StateValue }> = [
		{
			_id: WALLBOX_STATUS_STATES.chargingMode,
			common: {
				name: "Wallbox Lademodus (EMS)",
				type: "string",
				role: "text",
				read: true,
				write: false,
				def: "off",
			},
			defVal: "off",
		},
		{
			_id: WALLBOX_STATUS_STATES.chargingModeLabel,
			common: {
				name: "Wallbox Lademodus Anzeige (DE)",
				type: "string",
				role: "text",
				read: true,
				write: false,
				def: "Aus",
			},
			defVal: "Aus",
		},
		{
			_id: WALLBOX_STATUS_STATES.vehicleSocPct,
			common: {
				name: "Fahrzeug-SOC (%)",
				type: "number",
				role: "value.battery",
				unit: "%",
				read: true,
				write: false,
			},
		},
		{
			_id: WALLBOX_STATUS_STATES.updatedAt,
			common: {
				name: "Status zuletzt aktualisiert (EMS)",
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
