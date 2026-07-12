import { hydrateAcRuntimePersist, type AcRuntimeHost } from "../addons/air_conditioning/runtime/engine";
import { hydrateImmersionRuntimePersist, type ImmersionRuntimeHost } from "../addons/immersion_heater/runtime/engine";
import { hydrateWallboxVehicleSocPersistence } from "../addons/wallbox/vehicles/runtime";
import { hydrateIntentPersist, type IntentEngineHost } from "../intent/engine";
import { restoreLearningPersistenceFromStates } from "../learning/persistence_mirror";
import { learningDataPath } from "../learning/data_dir";
import { getLearningStateTreeHost } from "../ems_light";
import { markModuleInit } from "../diagnostics/init_guard";
import { probeStartupMemory } from "../diagnostics/startup_memory";
import { logMemoryInventory } from "../diagnostics/memory_inventory";

export type PersistHydrateHost = ioBroker.Adapter & {
	config: unknown;
	log: ioBroker.Logger;
};

function intentHydrateHost(adapter: PersistHydrateHost): IntentEngineHost {
	return {
		config: adapter.config,
		log: adapter.log,
		getAbsolutePath: (category?: string) => learningDataPath(adapter, category),
		setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
		getStateAsync: adapter.getStateAsync.bind(adapter),
		setStateAsync: adapter.setStateAsync.bind(adapter),
		getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
	};
}

function immersionHydrateHost(adapter: PersistHydrateHost): ImmersionRuntimeHost {
	return {
		config: adapter.config,
		log: adapter.log,
		getAbsolutePath: (category?: string) => learningDataPath(adapter, category),
		setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
		getStateAsync: adapter.getStateAsync.bind(adapter),
		setStateAsync: adapter.setStateAsync.bind(adapter),
		getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
		setForeignStateAsync: adapter.setForeignStateAsync.bind(adapter),
	};
}

function acHydrateHost(adapter: PersistHydrateHost): AcRuntimeHost {
	return {
		config: adapter.config,
		namespace: adapter.namespace,
		log: adapter.log,
		getAbsolutePath: (category?: string) => learningDataPath(adapter, category),
		setObjectNotExistsAsync: adapter.setObjectNotExistsAsync.bind(adapter),
		getStateAsync: adapter.getStateAsync.bind(adapter),
		setStateAsync: adapter.setStateAsync.bind(adapter),
		getForeignStateAsync: adapter.getForeignStateAsync.bind(adapter),
		setForeignStateAsync: adapter.setForeignStateAsync.bind(adapter),
	};
}

function wallboxVehicleHydrateHost(adapter: PersistHydrateHost): ioBroker.Adapter {
	return adapter;
}

/**
 * Phase D — Persistenz aus Dateien/Spiegelstates laden.
 * Läuft nach Ensure (B/C) und vor Sync, Subscriptions und Runtime-Auswertung.
 */
export async function hydratePersistedState(host: PersistHydrateHost): Promise<void> {
	probeStartupMemory(host.log, "before_persist_hydration");
	markModuleInit("persist_hydration");
	markModuleInit("persist_hydration");

	const learningHost = getLearningStateTreeHost();
	if (learningHost) {
		probeStartupMemory(host.log, "before_learning_persist_mirror");
		await restoreLearningPersistenceFromStates(learningHost);
		logMemoryInventory(host.log, "learning_persist_mirror", "after_restore");
		probeStartupMemory(host.log, "after_learning_persist_mirror");
	}

	probeStartupMemory(host.log, "before_intent_hydration");
	await hydrateIntentPersist(intentHydrateHost(host));
	probeStartupMemory(host.log, "after_intent_hydration");

	probeStartupMemory(host.log, "before_immersion_hydration");
	await hydrateImmersionRuntimePersist(immersionHydrateHost(host));
	probeStartupMemory(host.log, "after_immersion_hydration");

	probeStartupMemory(host.log, "before_ac_hydration");
	await hydrateAcRuntimePersist(acHydrateHost(host));
	probeStartupMemory(host.log, "after_ac_hydration");

	await hydrateWallboxVehicleSocPersistence(wallboxVehicleHydrateHost(host), host.config);
	probeStartupMemory(host.log, "after_persist_hydration");
}
