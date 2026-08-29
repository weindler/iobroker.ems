import { ensureAirConditioningStateTree } from "../addons/air_conditioning";
import { ensureBatteryStateTree } from "../addons/battery";
import { ensureImmersionHeaterStateTree } from "../addons/immersion_heater";
import { ensureMeasuredConsumersStateTree } from "../addons/measured_consumers";
import { ensureWallboxStaticStateTree, ensureWallboxDynamicVehicleProfiles } from "../addons/wallbox";
import { ensureAddonGovernanceStates } from "../addons/governance";
import { ensureAddonRuntimeSurfaceStates } from "../addons/runtime_surface";
import { ensureEmsLightStateTree } from "../ems_light";
import {
	ensureChannelTree,
	ensureGlobalExecutionStates,
	ensureAddonExecutionModeStates,
} from "../execution_mode";
import { ensureWallboxStatusStates } from "../status_wallbox";
import { ensureCommandBaseStates, ensureAddonBasisStates } from "./base_ensure";
import { ensureBackupStates } from "../backup/ensure_states";
import { runDynamicSurfaceCleanup, type SurfaceCleanupHost } from "../surface_cleanup/cleanup";

export type StaticStateTreeHost = ioBroker.Adapter & {
	config: unknown;
};

/** Phase B — statischer EMS-State-Tree ohne dynamische Fahrzeugprofile. */
export async function ensureStaticStateTree(host: StaticStateTreeHost): Promise<void> {
	await ensureChannelTree(host.setObjectNotExistsAsync.bind(host));
	await ensureCommandBaseStates(host);
	await ensureGlobalExecutionStates(host);
	await ensureAddonExecutionModeStates(host);
	await ensureAddonBasisStates(host);
	await ensureAddonGovernanceStates(host);
	await ensureAddonRuntimeSurfaceStates(host);
	await ensureEmsLightStateTree(host);
	await ensureBackupStates(host);
	await ensureWallboxStatusStates(host);
	await ensureWallboxStaticStateTree(host);
	await ensureBatteryStateTree(host);
	await ensureImmersionHeaterStateTree(host);
	await ensureAirConditioningStateTree(host);
	await ensureMeasuredConsumersStateTree(host);
}

/** Phase C — no-op since v0.1.227 (fat vehicle profile trees removed; see `wb_vehicle_map`). */
export async function ensureDynamicVehicleProfiles(host: StaticStateTreeHost): Promise<void> {
	await ensureWallboxDynamicVehicleProfiles(host);
}

/**
 * Phase 4B1 — controlled cleanup of unconfigured AC / orphan vehicle placeholders.
 * Runs after ensure so configured trees exist; idempotent.
 */
export async function cleanupDynamicPlaceholders(host: StaticStateTreeHost): Promise<void> {
	const cleanupHost: SurfaceCleanupHost = {
		namespace: host.namespace,
		config: host.config,
		log: host.log,
		getObjectAsync: (id) => host.getObjectAsync(id),
		delObjectAsync: (id, opts) => host.delObjectAsync(id, opts),
		listRelativeObjectIds: async () => {
			const listFn = (
				host as StaticStateTreeHost & {
					getObjectListAsync?: (params: {
						startkey: string;
						endkey: string;
					}) => Promise<{ rows?: Array<{ id: string }> }>;
				}
			).getObjectListAsync;
			if (typeof listFn !== "function") {
				return [];
			}
			// Full instance namespace — cleanup needs stub leaves + mapping allowed_values.
			const start = `${host.namespace}.`;
			const end = `${host.namespace}.\uffff`;
			const res = await listFn.call(host, { startkey: start, endkey: end });
			const rows = res?.rows ?? [];
			const prefix = `${host.namespace}.`;
			return rows
				.map((r) => r.id)
				.filter((id) => id.startsWith(prefix))
				.map((id) => id.slice(prefix.length));
		},
	};
	await runDynamicSurfaceCleanup(cleanupHost);
}

/** Mapping kommt aus der Adapterkonfiguration — keine ioBroker-Spiegel mehr. */
export async function syncAllMappingsFromConfig(_host: StaticStateTreeHost): Promise<void> {
	return;
}
