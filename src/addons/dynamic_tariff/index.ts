import { ensureAddonMappingStates, syncNativeMappingToStates } from "../../mapping_sync";
import {
	DYNAMIC_TARIFF_MAPPING_ROLES,
	dynamicTariffMappingFromConfig,
} from "./mapping_config";

export const DYNAMIC_TARIFF_ADDON_ID = "dynamic_tariff";

export async function initDynamicTariffModule(adapter: ioBroker.Adapter): Promise<null> {
	await ensureAddonMappingStates(adapter, DYNAMIC_TARIFF_ADDON_ID, DYNAMIC_TARIFF_MAPPING_ROLES);
	await syncNativeMappingToStates(adapter, DYNAMIC_TARIFF_ADDON_ID, dynamicTariffMappingFromConfig);
	adapter.log.info("dynamic_tariff: read-only price mapping");
	return null;
}
