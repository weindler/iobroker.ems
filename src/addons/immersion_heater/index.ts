import { touchEmsActivity, isEmsActivityStateId } from "../../ems_activity";
import { ensureEmsMirrorAliveState } from "../../ems_mirror_alive";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import { IMMERSION_HEATER_MAPPING_COMMANDS, immersionHeaterMappingFromConfig } from "./mapping_config";
import { ensureImmersionStatusStates } from "./status";
import {
	handleImmersionFaultReset,
	initImmersionRuntimeEngine,
	runImmersionRuntimeTick,
	stopImmersionRuntimeEngine,
	type ImmersionRuntimeHost,
} from "./runtime/engine";
import { IMMERSION_RUNTIME_STATES } from "./runtime/types";

export const IMMERSION_ADDON_ID = "immersion_heater";

function runtimeHost(adapter: ioBroker.Adapter): ImmersionRuntimeHost {
	const ext = adapter as ioBroker.Adapter & { getAbsolutePath?: (category?: string) => string };
	return {
		config: adapter.config,
		namespace: adapter.namespace,
		getAbsolutePath: ext.getAbsolutePath?.bind(adapter),
		log: adapter.log,
		setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
		getStateAsync: (id) => adapter.getStateAsync(id),
		getForeignStateAsync: (id) => adapter.getForeignStateAsync(id),
		setStateAsync: (id, st) => adapter.setStateAsync(id, st),
		setForeignStateAsync: (id, st) => adapter.setForeignStateAsync(id, st),
		subscribeStatesAsync: (p) => adapter.subscribeStatesAsync(p),
		subscribeForeignStatesAsync: (p) => adapter.subscribeForeignStatesAsync(p),
		unsubscribeStatesAsync: (p) => adapter.unsubscribeStatesAsync(p),
		unsubscribeForeignStatesAsync: (p) => adapter.unsubscribeForeignStatesAsync(p),
	};
}

export async function initImmersionHeaterModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureEmsMirrorAliveState(adapter);
	await ensureAddonMappingStates(adapter, IMMERSION_ADDON_ID, IMMERSION_HEATER_MAPPING_COMMANDS);
	await syncNativeMappingToStates(adapter, IMMERSION_ADDON_ID, immersionHeaterMappingFromConfig);
	await ensureImmersionStatusStates(adapter);
	await initImmersionRuntimeEngine(runtimeHost(adapter));

	touchEmsActivity();
	adapter.log.info("immersion_heater: runtime engine + mapping (failsafe via central runner)");
	return null;
}

export function stopImmersionHeaterModule(): void {
	stopImmersionRuntimeEngine();
}

export function handleImmersionHeaterStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	const ns = `${adapter.namespace}.`;
	if (isEmsActivityStateId(stateId, ns)) {
		touchEmsActivity();
	}
	const host = runtimeHost(adapter);
	if (stateId === `${ns}${IMMERSION_RUNTIME_STATES.faultReset}`) {
		void adapter.getStateAsync(IMMERSION_RUNTIME_STATES.faultReset).then((st) => {
			void handleImmersionFaultReset(host, st?.ack);
		});
		return;
	}
	if (
		stateId === `${ns}user_intent.thermal.resolved_json` ||
		stateId.endsWith(".user_intent.thermal.resolved_json")
	) {
		void runImmersionRuntimeTick(host).catch((e) => adapter.log.warn(`immersion runtime tick: ${e}`));
	}
}
