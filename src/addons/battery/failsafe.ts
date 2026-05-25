import { isLiveWriteAllowed } from "../../execution_mode";
import { failsafeTimeoutsFromConfig, isEmsUnreachable, readForeignNumber, setEdgeBool } from "../../failsafe_common";
import { BATTERY_STATUS_STATES } from "../../status_battery";
import { EMS_MIRROR_BATTERY } from "./ems_mirror";
import { mappedTargetId, readNumber } from "./io";
import { ensureOperatingMode, SONNEN_OPERATING_MODE_AUTO } from "./mode_control";
import { isModeSequenceRunning } from "./mode_orchestrator";
import type { BatteryTickHost } from "./grid_balance_runner";

let pendingDesiredMode: number | null = null;
let pendingSinceMs = 0;
let pendingRequestId: number | null = null;
let lastEmsReachable: boolean | null = null;

export function isBatteryAddonDead(adapter: BatteryTickHost): Promise<boolean> {
	return adapter.getStateAsync(BATTERY_STATUS_STATES.addonDead).then((st) => st?.val === true);
}

async function readActualOperatingMode(adapter: BatteryTickHost): Promise<number | null> {
	const { enabled, targetId } = await mappedTargetId(adapter, "operating_mode");
	if (!enabled || !targetId) {
		return null;
	}
	const n = await readForeignNumber(adapter, targetId);
	if (n == null) return null;
	const m = Math.round(n);
	return m === 1 || m === 2 ? m : null;
}

export async function noteBatteryModeDesired(adapter: BatteryTickHost): Promise<void> {
	const target = await readNumber(adapter, EMS_MIRROR_BATTERY.operatingModeTarget);
	const reqId = await readNumber(adapter, EMS_MIRROR_BATTERY.modeRequestId);
	if (target !== 1 && target !== 2) {
		return;
	}
	if (reqId == null || reqId <= 0) {
		return;
	}
	if (reqId === pendingRequestId && target === pendingDesiredMode) {
		return;
	}
	pendingRequestId = reqId;
	pendingDesiredMode = target;
	pendingSinceMs = Date.now();
}

async function forceBatterySafeMode2(adapter: BatteryTickHost, reason: string): Promise<boolean> {
	const live = await isLiveWriteAllowed((id) => adapter.getStateAsync(id), "battery");
	if (!live) {
		return false;
	}
	const err = await ensureOperatingMode(adapter, SONNEN_OPERATING_MODE_AUTO, true);
	if (err) {
		adapter.log.warn(`battery failsafe (${reason}): mode 2 not written (${err})`);
		return false;
	}
	adapter.log.warn(`battery failsafe (${reason}): forced operating mode 2 (Eigenverbrauch)`);
	return true;
}

export async function runBatteryFailsafeCheck(adapter: BatteryTickHost): Promise<void> {
	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const { verificationTimeoutSec } = failsafeTimeoutsFromConfig(cfg, "bat");
	const liveAllowed = await isLiveWriteAllowed((id) => adapter.getStateAsync(id), "battery");
	const emsReachable = !isEmsUnreachable(cfg, "bat");

	await setEdgeBool(adapter, BATTERY_STATUS_STATES.emsReachable, emsReachable);

	if (lastEmsReachable !== emsReachable) {
		lastEmsReachable = emsReachable;
		adapter.log.info(`battery: ems_reachable=${emsReachable}`);
	}

	const ts = new Date().toISOString();
	await adapter.setStateAsync(BATTERY_STATUS_STATES.updatedAt, { val: ts, ack: true });

	await noteBatteryModeDesired(adapter);

	const actual = await readActualOperatingMode(adapter);
	const desired = pendingDesiredMode;
	const verificationDue =
		desired != null &&
		actual != null &&
		actual !== desired &&
		Date.now() - pendingSinceMs >= verificationTimeoutSec * 1000;

	const seqStuck =
		isModeSequenceRunning() && Date.now() - pendingSinceMs >= verificationTimeoutSec * 1000;

	const shouldTrip = !emsReachable || verificationDue || seqStuck;

	await setEdgeBool(adapter, BATTERY_STATUS_STATES.failsafeWouldTrip, shouldTrip && !liveAllowed);

	const dead = await adapter.getStateAsync(BATTERY_STATUS_STATES.addonDead);
	if (dead?.val === true && emsReachable && actual === SONNEN_OPERATING_MODE_AUTO) {
		await setEdgeBool(adapter, BATTERY_STATUS_STATES.addonDead, false);
		await setEdgeBool(adapter, BATTERY_STATUS_STATES.actuatorReachable, true);
		pendingDesiredMode = 2;
	}

	if (!shouldTrip) {
		if (actual != null && desired != null && actual === desired) {
			await setEdgeBool(adapter, BATTERY_STATUS_STATES.actuatorReachable, true);
			await setEdgeBool(adapter, BATTERY_STATUS_STATES.addonDead, false);
		}
		const active = await adapter.getStateAsync(BATTERY_STATUS_STATES.failsafeActive);
		if (active?.val === true && liveAllowed) {
			await adapter.setStateAsync(BATTERY_STATUS_STATES.failsafeActive, { val: false, ack: true });
		}
		return;
	}

	if (!liveAllowed) {
		return;
	}

	const reason = !emsReachable ? "ems_unreachable" : seqStuck ? "mode_sequence_stuck" : "mode_verify_timeout";
	const wrote = await forceBatterySafeMode2(adapter, reason);
	if (wrote) {
		await setEdgeBool(adapter, BATTERY_STATUS_STATES.actuatorReachable, false);
		await setEdgeBool(adapter, BATTERY_STATUS_STATES.addonDead, true);
		await adapter.setStateAsync(BATTERY_STATUS_STATES.failsafeActive, { val: true, ack: true });
		await adapter.setStateAsync(BATTERY_STATUS_STATES.lastFailsafeAt, { val: ts, ack: true });
		pendingDesiredMode = 2;
		pendingSinceMs = Date.now();
	}
}
