import { hydrateAcRuntimePersist, type AcRuntimeHost } from "../addons/air_conditioning/runtime/engine";
import { hydrateImmersionRuntimePersist, type ImmersionRuntimeHost } from "../addons/immersion_heater/runtime/engine";
import { hydrateWallboxVehicleSocPersistence } from "../addons/wallbox/vehicles/runtime";
import { hydrateIntentPersist, type IntentEngineHost } from "../intent/engine";
import { restoreLearningPersistenceFromStates } from "../learning/persistence_mirror";
import { learningDataPath } from "../learning/data_dir";
import { getLearningStateTreeHost } from "../ems_light";

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
	const learningHost = getLearningStateTreeHost();
	if (learningHost) {
		await restoreLearningPersistenceFromStates(learningHost);
	}
	await hydrateIntentPersist(intentHydrateHost(host));
	await hydrateImmersionRuntimePersist(immersionHydrateHost(host));
	await hydrateAcRuntimePersist(acHydrateHost(host));
	await hydrateWallboxVehicleSocPersistence(wallboxVehicleHydrateHost(host), host.config);
}
