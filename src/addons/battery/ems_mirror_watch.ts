import { EMS_MIRROR_BATTERY, EMS_MIRROR_BATTERY_IDS } from "./ems_mirror";
import { handleEmsModeRequest, onEmsIntentReleased } from "./mode_orchestrator";
import { readBool, readNumber } from "./io";
import type { BatteryTickHost } from "./grid_balance_runner";

export function isEmsMirrorStateId(relativeOrFullId: string, adapterNamespace: string): boolean {
	const rel = relativeOrFullId.startsWith(adapterNamespace)
		? relativeOrFullId.slice(adapterNamespace.length + 1)
		: relativeOrFullId;
	return (EMS_MIRROR_BATTERY_IDS as readonly string[]).includes(rel);
}

export async function setupEmsMirrorWatch(adapter: BatteryTickHost): Promise<void> {
	for (const relId of EMS_MIRROR_BATTERY_IDS) {
		await adapter.subscribeStatesAsync(relId);
	}
}

export async function handleEmsMirrorStateChange(adapter: BatteryTickHost): Promise<void> {
	const reqId = await readNumber(adapter, EMS_MIRROR_BATTERY.modeRequestId);
	if (reqId != null && reqId > 0) {
		await handleEmsModeRequest(adapter);
		return;
	}
	const intent = await readBool(adapter, EMS_MIRROR_BATTERY.batteryIntentActive);
	if (!intent) {
		await onEmsIntentReleased(adapter);
	}
}
