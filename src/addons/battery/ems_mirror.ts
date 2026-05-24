/** States, die EMS schreibt — Adapter liest (Schritt C). */

export const EMS_MIRROR_BATTERY = {
	gridBalanceEnabled: "ems_mirror.grid_balance_enabled",
	effectivePvRestOfDayKwh: "ems_mirror.effective_pv_rest_of_day_kwh",
	snowCoverSuspected: "ems_mirror.snow_cover_suspected",
	batteryIntentActive: "ems_mirror.battery_intent_active",
	capacityWh: "ems_mirror.capacity_wh",
} as const;

export async function ensureBatteryEmsMirrorStates(adapter: ioBroker.Adapter): Promise<void> {
	const defs: Array<{ _id: string; common: ioBroker.StateCommon; defVal?: ioBroker.StateValue }> = [
		{
			_id: EMS_MIRROR_BATTERY.gridBalanceEnabled,
			common: {
				name: "EMS: Netzausgleich erlaubt",
				type: "boolean",
				role: "switch",
				read: true,
				write: true,
				def: false,
			},
			defVal: false,
		},
		{
			_id: EMS_MIRROR_BATTERY.effectivePvRestOfDayKwh,
			common: {
				name: "EMS: effektive Rest-PV heute (kWh)",
				type: "number",
				role: "value",
				unit: "kWh",
				read: true,
				write: true,
			},
		},
		{
			_id: EMS_MIRROR_BATTERY.snowCoverSuspected,
			common: {
				name: "EMS: Schnee/Vollabdichtung vermutet",
				type: "boolean",
				role: "state",
				read: true,
				write: true,
				def: false,
			},
			defVal: false,
		},
		{
			_id: EMS_MIRROR_BATTERY.batteryIntentActive,
			common: {
				name: "EMS: Batterie-Intent aktiv (Mutex → ems)",
				type: "boolean",
				role: "state",
				read: true,
				write: true,
				def: false,
			},
			defVal: false,
		},
		{
			_id: EMS_MIRROR_BATTERY.capacityWh,
			common: {
				name: "EMS: Batteriekapazität (Wh)",
				type: "number",
				role: "value",
				unit: "Wh",
				read: true,
				write: true,
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
			if (cur?.val === undefined || cur.val === null) {
				await adapter.setStateAsync(def._id, { val: def.defVal, ack: true });
			}
		}
	}
}
