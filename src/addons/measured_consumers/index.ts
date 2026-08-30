import { withLearningDataPath } from "../../learning/data_dir";
import {
	initMeasuredConsumersRuntimeEngine,
	runMeasuredConsumersTick,
	stopMeasuredConsumersRuntimeEngine,
	type MeasuredConsumersRuntimeHost,
} from "./runtime/engine";
import { configuredMeasuredConsumerSlots } from "./config";
import { ensureMeasuredConsumersStates } from "./runtime/ensure_states";

export const MEASURED_CONSUMERS_ADDON_ID = "measured_consumers";

function runtimeHost(adapter: ioBroker.Adapter): MeasuredConsumersRuntimeHost {
	const base: MeasuredConsumersRuntimeHost = {
		config: adapter.config,
		log: adapter.log,
		setObjectNotExistsAsync: (id, obj) => adapter.setObjectNotExistsAsync(id, obj),
		extendObjectAsync: (id, obj) => adapter.extendObjectAsync(id, obj),
		getStateAsync: (id) => adapter.getStateAsync(id),
		getForeignStateAsync: (id) => adapter.getForeignStateAsync(id),
		getForeignObjectAsync: (id) => adapter.getForeignObjectAsync(id),
		getObjectAsync: (id) => adapter.getObjectAsync(id),
		setStateAsync: (id, st) => adapter.setStateAsync(id, st),
	};
	return withLearningDataPath(adapter, base);
}

/** Phase B — statischer State-Tree; nur Zeilen aus der Admin-Tabelle (kein 20-facher Leerlauf). */
export async function ensureMeasuredConsumersStateTree(adapter: ioBroker.Adapter): Promise<void> {
	const slots = configuredMeasuredConsumerSlots(adapter.config);
	await ensureMeasuredConsumersStates(runtimeHost(adapter), slots);
}

/** Phase E — periodischer Tick (rein lesend, keine Geräte-Writes). */
export async function startMeasuredConsumersModuleRuntime(adapter: ioBroker.Adapter): Promise<null> {
	await initMeasuredConsumersRuntimeEngine(runtimeHost(adapter));
	adapter.log.debug("measured_consumers: runtime engine (rein messend, kein Schalten)");
	return null;
}

/** Post-Bootstrap-Reconciliation — aktuelle Fremdeingänge einmalig neu einlesen. */
export async function refreshMeasuredConsumersRuntime(adapter: ioBroker.Adapter): Promise<void> {
	await runMeasuredConsumersTick(runtimeHost(adapter));
}

export function stopMeasuredConsumersModule(): void {
	stopMeasuredConsumersRuntimeEngine();
}
