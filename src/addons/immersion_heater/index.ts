import { touchEmsActivity, isEmsActivityStateId } from "../../ems_activity";
import { ensureEmsMirrorAliveState } from "../../ems_mirror_alive";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import { IMMERSION_HEATER_MAPPING_COMMANDS, immersionHeaterMappingFromConfig } from "./mapping_config";
import { ensureImmersionStatusStates } from "./status";

export const IMMERSION_ADDON_ID = "immersion_heater";

export async function initImmersionHeaterModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureEmsMirrorAliveState(adapter);
	await ensureAddonMappingStates(adapter, IMMERSION_ADDON_ID, IMMERSION_HEATER_MAPPING_COMMANDS);
	await syncNativeMappingToStates(adapter, IMMERSION_ADDON_ID, immersionHeaterMappingFromConfig);
	await ensureImmersionStatusStates(adapter);

	touchEmsActivity();
	adapter.log.info("immersion_heater: mapping set_enabled (failsafe via central runner)");
	return null;
}

export function stopImmersionHeaterModule(): void {
	/* failsafe timer in failsafe_runner */
}

export function handleImmersionHeaterStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	const ns = `${adapter.namespace}.`;
	if (isEmsActivityStateId(stateId, ns)) {
		touchEmsActivity();
	}
}
