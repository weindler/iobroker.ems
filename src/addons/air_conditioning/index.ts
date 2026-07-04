import { touchEmsActivity } from "../../ems_activity";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import { AC_ADDON_ID } from "./constants";
import { acMappingCommands, acMappingFromConfig } from "./mapping_config";
import { addonAvailable, addonEnabled } from "../../tree_paths";
import {
	acRuntimeWatchedForeignIds,
	initAcRuntimeEngine,
	runAcRuntimeTick,
	stopAcRuntimeEngine,
	type AcRuntimeHost,
} from "./runtime/engine";

function runtimeHost(adapter: ioBroker.Adapter): AcRuntimeHost {
	const ext = adapter as ioBroker.Adapter & { getAbsolutePath?: (category?: string) => string };
	return {
		config: adapter.config,
		namespace: adapter.namespace,
		getAbsolutePath: ext.getAbsolutePath?.bind(adapter),
		log: adapter.log,
		setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
		getStateAsync: (id) => adapter.getStateAsync(id),
		getForeignStateAsync: (id) => adapter.getForeignStateAsync(id),
		setForeignStateAsync: (id, st) => adapter.setForeignStateAsync(id, st),
		setStateAsync: (id, st) => adapter.setStateAsync(id, st),
		subscribeStatesAsync: (p) => adapter.subscribeStatesAsync(p),
		subscribeForeignStatesAsync: (p) => adapter.subscribeForeignStatesAsync(p),
		unsubscribeForeignStatesAsync: (p) => adapter.unsubscribeForeignStatesAsync(p),
	};
}

export async function initAirConditioningModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureAddonMappingStates(adapter, AC_ADDON_ID, acMappingCommands());
	await syncNativeMappingToStates(adapter, AC_ADDON_ID, acMappingFromConfig);
	await initAcRuntimeEngine(runtimeHost(adapter));
	touchEmsActivity();
	adapter.log.info("air_conditioning: runtime engine initialized");
	return null;
}

export function stopAirConditioningModule(): void {
	stopAcRuntimeEngine();
}

export function handleAirConditioningStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	const ns = `${adapter.namespace}.`;
	if (
		stateId === `${ns}${addonEnabled(AC_ADDON_ID)}` ||
		stateId === `${ns}${addonAvailable(AC_ADDON_ID)}` ||
		acRuntimeWatchedForeignIds(adapter.config).includes(stateId)
	) {
		void runAcRuntimeTick(runtimeHost(adapter)).catch((e) => adapter.log.warn(`ac runtime tick: ${e}`));
	}
}
