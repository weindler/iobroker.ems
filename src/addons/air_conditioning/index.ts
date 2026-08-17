import { touchEmsActivity } from "../../ems_activity";
import { withLearningDataPath } from "../../learning/data_dir";
import { AC_ADDON_ID } from "./constants";
import { addonAvailable, addonEnabled } from "../../tree_paths";
import { DAILY_PLAN_STATE_IDS, ALLOCATION_ADDON_STATE_IDS } from "../../operator/daily_plan/states";
import { ensureAcRuntimeStates } from "./runtime/ensure_states";
import {
	acRuntimeWatchedForeignIds,
	initAcRuntimeEngine,
	runAcRuntimeTick,
	stopAcRuntimeEngine,
	type AcRuntimeHost,
} from "./runtime/engine";

function runtimeHost(adapter: ioBroker.Adapter): AcRuntimeHost {
	const base: AcRuntimeHost = {
		config: adapter.config,
		namespace: adapter.namespace,
		log: adapter.log,
		updateConfig:
			typeof (adapter as ioBroker.Adapter & { updateConfig?: AcRuntimeHost["updateConfig"] })
				.updateConfig === "function"
				? (next) =>
						(
							adapter as ioBroker.Adapter & {
								updateConfig: NonNullable<AcRuntimeHost["updateConfig"]>;
							}
						).updateConfig(next)
				: undefined,
		setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
		extendObjectAsync: (id, obj) => adapter.extendObjectAsync(id, obj),
		getStateAsync: (id) => adapter.getStateAsync(id),
		getForeignStateAsync: (id) => adapter.getForeignStateAsync(id),
		setForeignStateAsync: (id, st) => adapter.setForeignStateAsync(id, st),
		setStateAsync: (id, st) => adapter.setStateAsync(id, st),
		subscribeStatesAsync: (p) => adapter.subscribeStatesAsync(p),
		subscribeForeignStatesAsync: (p) => adapter.subscribeForeignStatesAsync(p),
		unsubscribeForeignStatesAsync: (p) => adapter.unsubscribeForeignStatesAsync(p),
	};
	return withLearningDataPath(adapter, base);
}

export async function ensureAirConditioningStateTree(adapter: ioBroker.Adapter): Promise<void> {
	await ensureAcRuntimeStates(runtimeHost(adapter));
}

export async function startAirConditioningModuleRuntime(adapter: ioBroker.Adapter): Promise<null> {
	await initAcRuntimeEngine(runtimeHost(adapter));
	touchEmsActivity();
	return null;
}

/** Post-Bootstrap-Reconciliation — aktuelle Fremdeingänge erneut einlesen. */
export async function refreshAirConditioningRuntime(adapter: ioBroker.Adapter): Promise<void> {
	await runAcRuntimeTick(runtimeHost(adapter));
}

export async function initAirConditioningModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureAirConditioningStateTree(adapter);
	return startAirConditioningModuleRuntime(adapter);
}

export function stopAirConditioningModule(): void {
	stopAcRuntimeEngine();
}

export function handleAirConditioningStateChange(adapter: ioBroker.Adapter, stateId: string): void {
	const ns = `${adapter.namespace}.`;
	const planWake =
		stateId === `${ns}${DAILY_PLAN_STATE_IDS.revision}` ||
		stateId === `${ns}${DAILY_PLAN_STATE_IDS.status}` ||
		stateId === `${ns}${DAILY_PLAN_STATE_IDS.planJson}` ||
		stateId === `${ns}${ALLOCATION_ADDON_STATE_IDS.air_conditioning.status}` ||
		stateId === `${ns}${ALLOCATION_ADDON_STATE_IDS.air_conditioning.planJson}`;
	if (
		stateId === `${ns}${addonEnabled(AC_ADDON_ID)}` ||
		stateId === `${ns}${addonAvailable(AC_ADDON_ID)}` ||
		planWake ||
		acRuntimeWatchedForeignIds(adapter.config).includes(stateId)
	) {
		void runAcRuntimeTick(runtimeHost(adapter)).catch((e) => adapter.log.warn(`ac runtime tick: ${e}`));
	}
}
