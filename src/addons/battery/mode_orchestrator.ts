import { EMS_MIRROR_BATTERY } from "./ems_mirror";
import { mappedTargetId, readBool, readNumber, writeForeignIfLive } from "./io";
import { modeSwitchDelaysFromConfig } from "./mode_delays";
import {
	ensureOperatingMode,
	SONNEN_OPERATING_MODE_AUTO,
	SONNEN_OPERATING_MODE_MANUAL,
} from "./mode_control";
import type { BatteryTickHost } from "./grid_balance_runner";
import { BATTERY_LIVE_WRITES_ENABLED } from "./grid_balance_runner";

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => {
		setTimeout(resolve, ms);
	});

let gridBalancePaused = false;
let modeSequenceRunning = false;
let lastHandledRequestId: number | null = null;

export function isGridBalancePaused(): boolean {
	return gridBalancePaused || modeSequenceRunning;
}

export function isModeSequenceRunning(): boolean {
	return modeSequenceRunning;
}

async function setSequenceStatus(adapter: BatteryTickHost, status: string, detail?: string): Promise<void> {
	await adapter.setStateAsync("status.battery.mode_sequence_status", { val: status, ack: true });
	if (detail !== undefined) {
		await adapter.setStateAsync("status.battery.mode_sequence_detail", { val: detail, ack: true });
	}
}

export async function handleEmsModeRequest(adapter: BatteryTickHost): Promise<void> {
	const reqId = await readNumber(adapter, EMS_MIRROR_BATTERY.modeRequestId);
	const target = await readNumber(adapter, EMS_MIRROR_BATTERY.operatingModeTarget);
	const chargeW = await readNumber(adapter, EMS_MIRROR_BATTERY.chargePowerWRequest);

	if (reqId == null || reqId <= 0) {
		return;
	}
	if (lastHandledRequestId === reqId) {
		return;
	}
	if (modeSequenceRunning) {
		return;
	}

	const mode = target === 1 ? 1 : target === 2 ? 2 : null;
	if (mode == null) {
		return;
	}

	modeSequenceRunning = true;
	lastHandledRequestId = reqId;

	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const delays = modeSwitchDelaysFromConfig(cfg);
	const live = BATTERY_LIVE_WRITES_ENABLED;

	try {
		if (mode === 2) {
			await setSequenceStatus(adapter, "running", "mode_2_immediate");
			gridBalancePaused = true;
			await ensureOperatingMode(adapter, SONNEN_OPERATING_MODE_AUTO, live);
			gridBalancePaused = false;
			await setSequenceStatus(adapter, "done", "mode_2");
			adapter.log.info(`battery mode sequence: mode 2 (request ${reqId})`);
			return;
		}

		// Mode 1: Netzausgleich stoppen → warten → Modus → warten → optional charge
		await setSequenceStatus(adapter, "running", "pause_grid_balance");
		gridBalancePaused = true;
		adapter.log.info(
			`battery mode sequence: pause grid_balance ${delays.pauseGridBalanceSec}s (request ${reqId})`,
		);
		if (delays.pauseGridBalanceSec > 0) {
			await sleep(delays.pauseGridBalanceSec * 1000);
		}

		await setSequenceStatus(adapter, "running", "set_mode_1");
		await ensureOperatingMode(adapter, SONNEN_OPERATING_MODE_MANUAL, live);

		if (delays.waitAfterModeSec > 0) {
			await setSequenceStatus(adapter, "running", `wait_after_mode_${delays.waitAfterModeSec}s`);
			await sleep(delays.waitAfterModeSec * 1000);
		}

		const chargeMap = await mappedTargetId(adapter, "battery_charging_w");
		if (chargeW != null && chargeW > 0 && chargeMap.targetId) {
			await setSequenceStatus(adapter, "running", `write_charge_${chargeW}w`);
			const wrote = await writeForeignIfLive(adapter, chargeMap.targetId, Math.round(chargeW), live);
			adapter.log.info(
				`battery mode sequence: charge ${chargeW} W → ${chargeMap.targetId} (${wrote ? "live" : "dryrun"})`,
			);
		}

		// Modus 1 + EMS-Intent: Netzausgleich bleibt pausiert bis EMS Modus 2 anfordert
		const intentActive = await readBool(adapter, EMS_MIRROR_BATTERY.batteryIntentActive);
		if (!intentActive) {
			gridBalancePaused = false;
		}
		await setSequenceStatus(adapter, "done", intentActive ? "mode_1_hold_pause" : "mode_1");
	} catch (e) {
		gridBalancePaused = false;
		const msg = e instanceof Error ? e.message : String(e);
		await setSequenceStatus(adapter, "error", msg);
		adapter.log.error(`battery mode sequence failed: ${msg}`);
	} finally {
		modeSequenceRunning = false;
	}
}

/** EMS hat Intent beendet → Pause aufheben, ggf. Netzausgleich wieder erlauben. */
export async function onEmsIntentReleased(adapter: BatteryTickHost): Promise<void> {
	if (!modeSequenceRunning) {
		gridBalancePaused = false;
	}
	await setSequenceStatus(adapter, "idle", "");
}
