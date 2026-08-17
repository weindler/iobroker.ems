import { touchEmsActivity, isEmsActivityStateId } from "../../ems_activity";
import { ensureEmsMirrorAliveState } from "../../ems_mirror_alive";
import { withLearningDataPath } from "../../learning/data_dir";
import { ensureImmersionStatusStates } from "./status";
import { ensureImmersionRuntimeStates } from "./runtime/ensure_states";
import {
	handleImmersionFaultReset,
	immersionRuntimeWatchedForeignIds,
	initImmersionRuntimeEngine,
	runImmersionRuntimeTick,
	stopImmersionRuntimeEngine,
	type ImmersionRuntimeHost,
} from "./runtime/engine";
import { immersionDeviceConfigFromAdapter } from "./device_config";
import { IMMERSION_RUNTIME_STATES } from "./runtime/types";

export const IMMERSION_ADDON_ID = "immersion_heater";

function runtimeHost(adapter: ioBroker.Adapter): ImmersionRuntimeHost {
	const base: ImmersionRuntimeHost = {
		config: adapter.config,
		namespace: adapter.namespace,
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
	return withLearningDataPath(adapter, base);
}

export async function ensureImmersionHeaterStateTree(adapter: ioBroker.Adapter): Promise<void> {
	await ensureEmsMirrorAliveState(adapter);
	await ensureImmersionStatusStates(adapter);
	await ensureImmersionRuntimeStates(runtimeHost(adapter));
}

export async function startImmersionHeaterModuleRuntime(adapter: ioBroker.Adapter): Promise<null> {
	await initImmersionRuntimeEngine(runtimeHost(adapter));

	touchEmsActivity();
	adapter.log.debug("immersion_heater: runtime engine + mapping (failsafe via central runner)");
	return null;
}

/** Post-Bootstrap-Reconciliation — aktuelle Fremdeingänge erneut einlesen. */
export async function refreshImmersionHeaterRuntime(adapter: ioBroker.Adapter): Promise<void> {
	await runImmersionRuntimeTick(runtimeHost(adapter));
}

export async function initImmersionHeaterModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureImmersionHeaterStateTree(adapter);
	return startImmersionHeaterModuleRuntime(adapter);
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
			void handleImmersionFaultReset(host, st);
		});
		return;
	}
	if (
		stateId === `${ns}user_intent.thermal.resolved_json` ||
		stateId.endsWith(".user_intent.thermal.resolved_json")
	) {
		void runImmersionRuntimeTick(host).catch((e) => adapter.log.warn(`immersion runtime tick: ${e}`));
		return;
	}
	const config = immersionDeviceConfigFromAdapter(adapter.config);
	if (immersionRuntimeWatchedForeignIds(config).includes(stateId)) {
		void runImmersionRuntimeTick(host).catch((e) => adapter.log.warn(`immersion runtime tick: ${e}`));
	}
}
