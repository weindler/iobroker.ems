import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import { ensureBatteryStatusStates } from "../../status_battery";
import {
	clearConsumptionWatch,
	isWatchedConsumptionState,
	onConsumptionStateChange,
	setupConsumptionWatch,
} from "./consumption_watch";
import { ensureBatteryEmsMirrorStates } from "./ems_mirror";
import {
	handleEmsMirrorStateChange,
	isEmsMirrorStateId,
	setupEmsMirrorWatch,
} from "./ems_mirror_watch";
import { runGridBalanceOnConsumptionChange, type BatteryTickHost } from "./grid_balance_runner";
import {
	BATTERY_SONNEN_MAPPING_ROLES,
	sonnenBatteryMappingFromConfig,
	winterTickIntervalSecFromConfig,
} from "./mapping_config";
import { runWinterGridChargeTick } from "./winter_grid_charge";

export const BATTERY_ADDON_ID = "battery";

let winterTimer: NodeJS.Timeout | null = null;

export async function initBatteryModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureAddonMappingStates(adapter, BATTERY_ADDON_ID, BATTERY_SONNEN_MAPPING_ROLES);
	await syncNativeMappingToStates(adapter, BATTERY_ADDON_ID, sonnenBatteryMappingFromConfig);
	await ensureBatteryEmsMirrorStates(adapter);
	await ensureBatteryStatusStates(adapter);

	const host = adapter as BatteryTickHost;
	await setupConsumptionWatch(host);
	await setupEmsMirrorWatch(host);
	void runGridBalanceOnConsumptionChange(host, "startup");

	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const winterSec = winterTickIntervalSecFromConfig(cfg);
	winterTimer = setInterval(() => {
		void runWinterGridChargeTick(host).catch((e) => {
			adapter.log.error(`battery winter tick: ${e}`);
		});
	}, winterSec * 1000);

	return null;
}

export function stopBatteryModule(_timer: NodeJS.Timeout | null): void {
	if (winterTimer) {
		clearInterval(winterTimer);
		winterTimer = null;
	}
	clearConsumptionWatch();
}

export function handleBatteryAdapterStateChange(
	adapter: ioBroker.Adapter,
	stateId: string,
): void {
	const host = adapter as BatteryTickHost;
	const ns = `${adapter.namespace}.`;

	if (isWatchedConsumptionState(stateId)) {
		onConsumptionStateChange(host);
		return;
	}

	if (isEmsMirrorStateId(stateId, ns)) {
		void handleEmsMirrorStateChange(host).catch((e) => adapter.log.error(`battery ems_mirror: ${e}`));
	}
}

/** @deprecated use handleBatteryAdapterStateChange */
export function handleBatteryForeignStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	handleBatteryAdapterStateChange(adapter, stateId);
}
