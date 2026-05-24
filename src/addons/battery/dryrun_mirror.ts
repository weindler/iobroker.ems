import type { GridBalanceResult } from "./grid_balance";

export const BATTERY_GRID_BALANCE_DRYRUN_SUFFIXES: Array<{
	suffix: string;
	common: ioBroker.StateCommon;
}> = [
	{ suffix: "timestamp", common: { name: "Tick timestamp", type: "string", role: "text", read: true, write: false } },
	{ suffix: "controller", common: { name: "Battery controller", type: "string", role: "text", read: true, write: false } },
	{ suffix: "gate_passed", common: { name: "Gate passed", type: "boolean", role: "state", read: true, write: false } },
	{ suffix: "target_battery_charging_w", common: { name: "Target Battery charging W", type: "number", role: "value.power", read: true, write: false } },
	{ suffix: "consumption_w", common: { name: "Consumption W", type: "number", role: "value.power", read: true, write: false } },
	{ suffix: "pv_ac_power_w", common: { name: "PV AC power W", type: "number", role: "value.power", read: true, write: false } },
	{ suffix: "soc_pct", common: { name: "SOC %", type: "number", role: "value", read: true, write: false } },
	{ suffix: "effective_rest_kwh", common: { name: "EMS effective rest kWh", type: "number", role: "value", read: true, write: false } },
	{ suffix: "reason_de", common: { name: "Reason DE", type: "string", role: "text", read: true, write: false } },
	{ suffix: "would_write", common: { name: "Would write target", type: "boolean", role: "state", read: true, write: false } },
	{ suffix: "target_state", common: { name: "Mapped write state id", type: "string", role: "text", read: true, write: false } },
	{ suffix: "last_tick_json", common: { name: "Last tick JSON", type: "string", role: "json", read: true, write: false } },
];

export type DryrunWriter = {
	setObjectNotExistsAsync: (id: string, obj: ioBroker.Object) => Promise<unknown>;
	setStateAsync: (id: string, state: ioBroker.SettableState) => Promise<unknown>;
};

export async function writeBatteryGridBalanceDryrun(
	writer: DryrunWriter,
	payload: {
		controller: string;
		result: GridBalanceResult;
		consumptionW: number | null;
		pvAcPowerW: number | null;
		socPct: number | null;
		effectiveRestKwh: number | null;
		targetStateId: string;
		trigger?: string;
	},
): Promise<void> {
	const base = "dryrun.battery.grid_balance";
	const ts = new Date().toISOString();

	for (const def of BATTERY_GRID_BALANCE_DRYRUN_SUFFIXES) {
		await writer.setObjectNotExistsAsync(`${base}.${def.suffix}`, {
			type: "state",
			common: { ...def.common, name: `battery grid_balance ${def.common.name}` },
			native: {},
		} as ioBroker.Object);
	}

	const tickJson = JSON.stringify({ timestamp: ts, ...payload });
	const values: Record<string, ioBroker.StateValue> = {
		timestamp: ts,
		controller: payload.controller,
		gate_passed: payload.result.gatePassed,
		target_battery_charging_w: payload.result.targetBatteryChargingW,
		consumption_w: payload.consumptionW ?? null,
		pv_ac_power_w: payload.pvAcPowerW ?? null,
		soc_pct: payload.socPct ?? null,
		effective_rest_kwh: payload.effectiveRestKwh ?? null,
		reason_de: payload.result.reasonDe,
		would_write: payload.result.gatePassed && !!payload.targetStateId,
		target_state: payload.targetStateId,
		last_tick_json: tickJson,
	};

	for (const [suffix, val] of Object.entries(values)) {
		await writer.setStateAsync(`${base}.${suffix}`, { val, ack: true });
	}
}
