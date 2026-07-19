import { ensureAirConditioningStateTree } from "../addons/air_conditioning";
import { ensureBatteryStateTree } from "../addons/battery";
import { ensureImmersionHeaterStateTree } from "../addons/immersion_heater";
import { ensureWallboxStaticStateTree, ensureWallboxDynamicVehicleProfiles } from "../addons/wallbox";
import { ensureAddonGovernanceStates } from "../addons/governance";
import { ensureAddonMappingStates, syncNativeMappingToStates } from "../mapping_sync";
import { wallboxMappingFromConfig, WALLBOX_ALL_MAPPING_IDS } from "../mapping_config";
import { ensureEmsLightStateTree } from "../ems_light";
import {
	ensureChannelTree,
	ensureGlobalExecutionStates,
	ensureAddonExecutionModeStates,
} from "../execution_mode";
import { ensureWallboxStatusStates } from "../status_wallbox";
import { DYNAMIC_TARIFF_ADDON_ID } from "../addons/dynamic_tariff";
import { DYNAMIC_TARIFF_MAPPING_ROLES, dynamicTariffMappingFromConfig } from "../addons/dynamic_tariff/mapping_config";
import { BATTERY_ADDON_ID } from "../addons/battery";
import { batteryMappingNativeFromConfig } from "../addons/battery/mapping";
import { IMMERSION_ADDON_ID } from "../addons/immersion_heater";
import { immersionHeaterMappingFromConfig } from "../addons/immersion_heater/mapping_config";
import { AC_ADDON_ID } from "../addons/air_conditioning/constants";
import { acMappingFromConfig } from "../addons/air_conditioning/mapping_config";
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
	await ensureEmsLightStateTree(host);
	await ensureBackupStates(host);
	await ensureAddonMappingStates(host, "wallbox", WALLBOX_ALL_MAPPING_IDS);
	await ensureWallboxStatusStates(host);
	await ensureWallboxStaticStateTree(host);
	await ensureBatteryStateTree(host);
	await ensureImmersionHeaterStateTree(host);
	await ensureAirConditioningStateTree(host);
	await ensureAddonMappingStates(host, DYNAMIC_TARIFF_ADDON_ID, DYNAMIC_TARIFF_MAPPING_ROLES);
}

/** Phase C — dynamische Fahrzeugprofil-Ordner aus `wb_vehicle_profiles`. */
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
			const start = `${host.namespace}.addons.wallbox.vehicles.`;
			const end = `${host.namespace}.addons.wallbox.vehicles.\uffff`;
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

/** Phase sync — Mapping-Werte aus Admin-Config (nach Objekterzeugung). */
export async function syncAllMappingsFromConfig(host: StaticStateTreeHost): Promise<void> {
	await syncNativeMappingToStates(host, "wallbox", wallboxMappingFromConfig);
	await syncNativeMappingToStates(host, BATTERY_ADDON_ID, batteryMappingNativeFromConfig);
	await syncNativeMappingToStates(host, IMMERSION_ADDON_ID, immersionHeaterMappingFromConfig);
	await syncNativeMappingToStates(host, AC_ADDON_ID, acMappingFromConfig);
	await syncNativeMappingToStates(host, DYNAMIC_TARIFF_ADDON_ID, dynamicTariffMappingFromConfig);
}
