import { batteryConfigFromAdapter } from "./config";
import { batteryMappingFromConfig } from "./mapping";
import { getBatteryProfile } from "./profiles/registry";
import { isLiveWriteAllowed } from "../../execution_mode";
import { writeForeignIfChanged } from "../../device_write";
import { isEmsUnreachable, setEdgeBool } from "../../failsafe_common";
import { BAT } from "./ensure_states";
import { markFailsafeSetpointTakeover } from "./runtime/setpoint_session";

const ADDON_ID = "battery";
/** Config-Präfix für `failsafeTimeoutsFromConfig` — analog "wb"/"ih". */
const CONFIG_PREFIX = "bat";

let lastEmsReachable: boolean | null = null;

/**
 * Erzwingt den sicheren Ruhezustand (charge 0 W, discharge 0 W, Self-Consumption)
 * direkt, ohne die FSM — analog `forceWallboxSafeOff` / `forceImmersionHeaterOff`. Läuft
 * unabhängig vom regulären Control-Tick, damit ein hängender Adapter-Loop die
 * Batterie nicht dauerhaft im aktiven Lade-Zustand belässt.
 */
async function forceBatterySafeState(adapter: ioBroker.Adapter, reason: string): Promise<boolean> {
	const config = batteryConfigFromAdapter(adapter.config);
	const table = batteryMappingFromConfig(adapter.config);
	const chargeTarget = table.set_charge_power.targetState;
	const dischargeTarget = table.set_discharge_power.targetState;
	const modeTarget = table.set_operating_mode.targetState;
	if (!chargeTarget && !dischargeTarget && !modeTarget) {
		adapter.log.warn(
			`battery failsafe (${reason}): no set_charge_power/set_discharge_power/set_operating_mode mapping`,
		);
		return false;
	}

	let wrote = false;
	try {
		if (chargeTarget) {
			const r = await writeForeignIfChanged(adapter, {
				stateId: chargeTarget,
				value: 0,
				reason: `battery failsafe: ${reason}`,
			});
			if (r.written) wrote = true;
		}
		if (dischargeTarget) {
			const r = await writeForeignIfChanged(adapter, {
				stateId: dischargeTarget,
				value: 0,
				reason: `battery failsafe discharge: ${reason}`,
			});
			if (r.written) wrote = true;
		}
		if (modeTarget) {
			const r = await writeForeignIfChanged(adapter, {
				stateId: modeTarget,
				value: config.sonnenModeValues.selfConsumption,
				reason: `battery failsafe: ${reason}`,
			});
			if (r.written) wrote = true;
		}
		adapter.log.warn(`battery failsafe (${reason}): charge/discharge 0, self-consumption forced`);
		return true;
	} catch (e) {
		adapter.log.error(`battery failsafe write failed: ${String(e)}`);
		return wrote;
	}
}

/**
 * Unabhängiger Sicherheitspfad (eigener Timer, siehe `failsafe_runner.ts`): erzwingt
 * Safe-Restore, wenn der EMS-Haupt-Tick nicht mehr läuft (Tick-Ausfall/Adapter-Hang) —
 * `batteryUnloadRestore` in `index.ts` deckt nur den sauberen Adapter-Unload ab.
 */
export async function runBatteryFailsafeCheck(adapter: ioBroker.Adapter): Promise<void> {
	const cfg =
		adapter.config && typeof adapter.config === "object" ? (adapter.config as Record<string, unknown>) : {};
	const config = batteryConfigFromAdapter(cfg);
	const profile = getBatteryProfile(config.profile);
	if (!profile.supportsLive) {
		return;
	}

	const liveAllowed = await isLiveWriteAllowed((id) => adapter.getStateAsync(id), ADDON_ID);
	const emsReachable = !isEmsUnreachable(cfg, CONFIG_PREFIX);

	await setEdgeBool(adapter, BAT.failsafe.emsReachable, emsReachable);
	if (lastEmsReachable !== emsReachable) {
		lastEmsReachable = emsReachable;
		adapter.log.debug(`battery: ems_reachable=${emsReachable}`);
	}
	await setEdgeBool(adapter, BAT.failsafe.wouldTrip, !emsReachable && !liveAllowed);

	const ts = new Date().toISOString();
	await adapter.setStateAsync(BAT.failsafe.updatedAt, { val: ts, ack: true });

	if (emsReachable) {
		const active = await adapter.getStateAsync(BAT.failsafe.active);
		if (active?.val === true && liveAllowed) {
			await adapter.setStateAsync(BAT.failsafe.active, { val: false, ack: true });
		}
		return;
	}

	if (!liveAllowed) {
		return;
	}

	const wrote = await forceBatterySafeState(adapter, "ems_unreachable");
	if (wrote) {
		await adapter.setStateAsync(BAT.failsafe.active, { val: true, ack: true });
		await adapter.setStateAsync(BAT.failsafe.lastFailsafeAt, { val: ts, ack: true });
		markFailsafeSetpointTakeover(ts);
	}
}

/** Nur für Tests: Kanten-Erkennung (Log-Debounce) zurücksetzen. */
export function __resetBatteryFailsafeForTest(): void {
	lastEmsReachable = null;
}
