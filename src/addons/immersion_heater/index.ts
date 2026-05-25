import { touchEmsActivity, isEmsActivityStateId } from "../../ems_activity";
import { ensureEmsMirrorAliveState } from "../../ems_mirror_alive";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import {
	IMMERSION_HEATER_MAPPING_COMMANDS,
	immersionFailsafeConfig,
	immersionHeaterMappingFromConfig,
} from "./mapping_config";
import { runImmersionFailsafeCheck } from "./failsafe";
import { ensureImmersionStatusStates } from "./status";

export const IMMERSION_ADDON_ID = "immersion_heater";

let failsafeTimer: NodeJS.Timeout | null = null;

export async function initImmersionHeaterModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureEmsMirrorAliveState(adapter);
	await ensureAddonMappingStates(adapter, IMMERSION_ADDON_ID, IMMERSION_HEATER_MAPPING_COMMANDS);
	await syncNativeMappingToStates(adapter, IMMERSION_ADDON_ID, immersionHeaterMappingFromConfig);
	await ensureImmersionStatusStates(adapter);

	touchEmsActivity();

	const cfg =
		adapter.config && typeof adapter.config === "object"
			? (adapter.config as Record<string, unknown>)
			: {};
	const { failsafeCheckIntervalSec } = immersionFailsafeConfig(cfg);

	failsafeTimer = setInterval(() => {
		void runImmersionFailsafeCheck(adapter).catch((e) => {
			adapter.log.error(`immersion failsafe tick: ${e}`);
		});
	}, failsafeCheckIntervalSec * 1000);

	adapter.log.info(
		`immersion_heater: mapping set_enabled, failsafe check ${failsafeCheckIntervalSec}s`,
	);

	return null;
}

export function stopImmersionHeaterModule(): void {
	if (failsafeTimer) {
		clearInterval(failsafeTimer);
		failsafeTimer = null;
	}
}

export function handleImmersionHeaterStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	const ns = `${adapter.namespace}.`;
	if (isEmsActivityStateId(stateId, ns)) {
		touchEmsActivity();
	}
}
