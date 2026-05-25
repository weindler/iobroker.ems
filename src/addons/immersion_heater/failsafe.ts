import { isLiveWriteAllowed } from "../../execution_mode";
import { msSinceEmsActivity } from "../../ems_activity";
import { mappingBase } from "../../tree_paths";
import { immersionFailsafeConfig } from "./mapping_config";
import { IMMERSION_STATUS_STATES } from "./status";

const ADDON_ID = "immersion_heater";

export type ImmersionFailsafeHost = ioBroker.Adapter & {
	config: unknown;
};

let lastEmsReachable: boolean | null = null;

async function setEdgeBool(
	adapter: ImmersionFailsafeHost,
	stateId: string,
	value: boolean,
): Promise<void> {
	const cur = await adapter.getStateAsync(stateId);
	if (cur?.val === value) {
		return;
	}
	await adapter.setStateAsync(stateId, { val: value, ack: true });
}

async function mappedEnableTarget(adapter: ImmersionFailsafeHost): Promise<string> {
	const base = mappingBase(ADDON_ID, "set_enabled");
	const en = await adapter.getStateAsync(`${base}.enabled`);
	if (en?.val === false) {
		return "";
	}
	const ts = await adapter.getStateAsync(`${base}.target_state`);
	return typeof ts?.val === "string" ? ts.val.trim() : "";
}

export async function forceImmersionHeaterOff(
	adapter: ImmersionFailsafeHost,
	reason: string,
): Promise<boolean> {
	const targetId = await mappedEnableTarget(adapter);
	if (!targetId) {
		adapter.log.warn(`immersion failsafe (${reason}): no set_enabled mapping`);
		return false;
	}
	const live = await isLiveWriteAllowed((id) => adapter.getStateAsync(id), ADDON_ID);
	if (!live) {
		return false;
	}
	try {
		await adapter.setForeignStateAsync(targetId, { val: false, ack: true });
		adapter.log.warn(`immersion failsafe (${reason}): OFF → ${targetId}`);
		return true;
	} catch (e) {
		adapter.log.error(`immersion failsafe write failed: ${e}`);
		return false;
	}
}

export async function runImmersionFailsafeCheck(adapter: ImmersionFailsafeHost): Promise<void> {
	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const { emsUnreachableTimeoutSec } = immersionFailsafeConfig(cfg);
	const liveAllowed = await isLiveWriteAllowed((id) => adapter.getStateAsync(id), ADDON_ID);

	const msSilent = msSinceEmsActivity();
	const emsReachable = msSilent < emsUnreachableTimeoutSec * 1000;
	const wouldTrip = !emsReachable;

	await setEdgeBool(adapter, IMMERSION_STATUS_STATES.emsReachable, emsReachable);
	await setEdgeBool(adapter, IMMERSION_STATUS_STATES.failsafeWouldTrip, wouldTrip && !liveAllowed);

	if (lastEmsReachable !== emsReachable) {
		lastEmsReachable = emsReachable;
		adapter.log.info(
			`immersion_heater: ems_reachable=${emsReachable} (silent ${Math.round(msSilent / 1000)}s)`,
		);
	}

	const ts = new Date().toISOString();
	await adapter.setStateAsync(IMMERSION_STATUS_STATES.updatedAt, { val: ts, ack: true });

	if (!wouldTrip) {
		if (!liveAllowed) {
			return;
		}
		const active = await adapter.getStateAsync(IMMERSION_STATUS_STATES.failsafeActive);
		if (active?.val === true) {
			await adapter.setStateAsync(IMMERSION_STATUS_STATES.failsafeActive, { val: false, ack: true });
		}
		return;
	}

	if (!liveAllowed) {
		return;
	}

	const wrote = await forceImmersionHeaterOff(adapter, "ems_unreachable");
	if (wrote) {
		await adapter.setStateAsync(IMMERSION_STATUS_STATES.failsafeActive, { val: true, ack: true });
		await adapter.setStateAsync(IMMERSION_STATUS_STATES.lastFailsafeAt, { val: ts, ack: true });
	}
}
