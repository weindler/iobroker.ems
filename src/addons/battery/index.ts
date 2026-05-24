import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import { ensureBatteryStatusStates } from "../../status_battery";
import { ensureBatteryEmsMirrorStates } from "./ems_mirror";
import {
	BATTERY_SONNEN_MAPPING_ROLES,
	sonnenBatteryMappingFromConfig,
	tickIntervalSecFromConfig,
} from "./mapping_config";
import { runBatteryGridBalanceTick, type BatteryTickHost } from "./tick";

export const BATTERY_ADDON_ID = "battery";

export async function initBatteryModule(adapter: ioBroker.Adapter): Promise<NodeJS.Timeout | null> {
	await ensureAddonMappingStates(adapter, BATTERY_ADDON_ID, BATTERY_SONNEN_MAPPING_ROLES);
	await syncNativeMappingToStates(adapter, BATTERY_ADDON_ID, sonnenBatteryMappingFromConfig);
	await ensureBatteryEmsMirrorStates(adapter);
	await ensureBatteryStatusStates(adapter);

	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const intervalSec = tickIntervalSecFromConfig(cfg);
	const host = adapter as BatteryTickHost;

	const tick = (): void => {
		void runBatteryGridBalanceTick(host).catch((e) => {
			adapter.log.error(`battery grid_balance tick: ${e}`);
		});
	};

	tick();
	return setInterval(tick, intervalSec * 1000);
}

export function stopBatteryModule(timer: NodeJS.Timeout | null): void {
	if (timer) {
		clearInterval(timer);
	}
}
